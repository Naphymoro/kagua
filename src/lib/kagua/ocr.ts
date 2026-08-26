import type { ManuscriptExtraction } from "./types";

const DEFAULT_UPLOAD_MB = 25;
const MAX_EXTRACTED_CHARS = 60000;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".tex"]);
const OCR_EXTENSIONS = new Set([".pdf", ".docx", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "application/x-tex"]);

export class ManuscriptExtractionError extends Error {
  constructor(
    message: string,
    public status = 422,
    public code = "MANUSCRIPT_EXTRACTION_FAILED",
  ) {
    super(message);
  }
}

export function manuscriptUploadLimitBytes() {
  const configured = Number(process.env.OCR_MAX_UPLOAD_MB || DEFAULT_UPLOAD_MB);
  const mb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_UPLOAD_MB;
  return Math.floor(mb * 1024 * 1024);
}

export async function extractManuscriptFromFile(file: File): Promise<ManuscriptExtraction> {
  const fileName = cleanFileName(file.name || "manuscript");
  const extension = extensionOf(fileName);
  const fileType = file.type || inferMimeType(extension);

  if (!TEXT_EXTENSIONS.has(extension) && !OCR_EXTENSIONS.has(extension) && !fileType.startsWith("image/")) {
    throw new ManuscriptExtractionError(
      "Upload a PDF, DOCX, TXT/MD export, or image manuscript scan.",
      400,
      "UNSUPPORTED_MANUSCRIPT_FILE",
    );
  }

  if (file.size <= 0) {
    throw new ManuscriptExtractionError("The uploaded manuscript file is empty.", 400, "EMPTY_MANUSCRIPT_FILE");
  }

  const limit = manuscriptUploadLimitBytes();
  if (file.size > limit) {
    throw new ManuscriptExtractionError(
      `The manuscript is too large. The current upload limit is ${Math.round(limit / 1024 / 1024)} MB.`,
      413,
      "MANUSCRIPT_TOO_LARGE",
    );
  }

  if (isTextFile(extension, fileType)) {
    return buildExtraction({
      file,
      fileName,
      fileType,
      provider: "plain-text upload",
      text: await file.text(),
      confidence: 0.92,
      warnings: [],
    });
  }

  const endpoint = process.env.OCR_ENDPOINT_URL?.trim();
  if (!endpoint) {
    throw new ManuscriptExtractionError(
      "OCR is not connected yet. Set OCR_ENDPOINT_URL to a Baidu Unlimited-OCR service, Hugging Face endpoint, or self-hosted OCR adapter.",
      422,
      "OCR_NOT_CONFIGURED",
    );
  }

  return callExternalOcr(file, fileName, fileType, endpoint);
}

async function callExternalOcr(file: File, fileName: string, fileType: string, endpoint: string) {
  const provider = process.env.OCR_PROVIDER?.trim() || "unlimited-ocr";
  const timeoutMs = Number(process.env.OCR_TIMEOUT_MS || 55000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 55000);
  const form = new FormData();
  form.append("file", file, fileName);
  form.append("provider", provider);
  form.append("schemaVersion", "kagua-manuscript-v1");
  form.append(
    "prompt",
    "Extract the complete manuscript text. Preserve headings, abstract, keywords, tables as readable text, and page order. Return JSON with text, title, abstract, keywords, confidence, pageCount, and warnings when possible.",
  );

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: process.env.OCR_API_KEY ? { Authorization: `Bearer ${process.env.OCR_API_KEY}` } : undefined,
      body: form,
      signal: controller.signal,
    });
    const raw = await response.text();
    const payload = parsePayload(raw);

    if (!response.ok) {
      throw new ManuscriptExtractionError(
        `${provider} OCR failed: ${response.status} ${errorText(payload, raw)}`,
        response.status >= 500 ? 502 : response.status,
        "OCR_PROVIDER_FAILED",
      );
    }

    const text = extractText(payload);
    if (!text.trim()) {
      throw new ManuscriptExtractionError(
        `${provider} OCR returned no manuscript text.`,
        502,
        "OCR_RETURNED_EMPTY_TEXT",
      );
    }

    return buildExtraction({
      file,
      fileName,
      fileType,
      provider,
      text,
      title: stringFrom(payload, "title"),
      abstract: stringFrom(payload, "abstract"),
      keywords: keywordsFromPayload(payload),
      confidence: numberFrom(payload, "confidence"),
      pageCount: numberFrom(payload, "pageCount") || numberFrom(payload, "pages"),
      warnings: warningsFromPayload(payload),
    });
  } catch (error) {
    if (error instanceof ManuscriptExtractionError) throw error;
    const message = error instanceof Error && error.name === "AbortError"
      ? `${provider} OCR timed out.`
      : error instanceof Error
        ? error.message
        : "Unknown OCR error.";
    throw new ManuscriptExtractionError(message, 502, "OCR_PROVIDER_UNREACHABLE");
  } finally {
    clearTimeout(timeout);
  }
}

function buildExtraction(input: {
  file: File;
  fileName: string;
  fileType: string;
  provider: string;
  text: string;
  title?: string;
  abstract?: string;
  keywords?: string[];
  confidence?: number;
  pageCount?: number;
  warnings: string[];
}): ManuscriptExtraction {
  const warnings = [...input.warnings];
  let text = normalizeText(input.text);
  if (text.length > MAX_EXTRACTED_CHARS) {
    text = text.slice(0, MAX_EXTRACTED_CHARS);
    warnings.push("The extraction was trimmed to the first 60,000 characters for journal discovery.");
  }
  const profile = profileText(text);
  return {
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.file.size,
    provider: input.provider,
    status: text ? "extracted" : "partial",
    text,
    title: input.title?.trim() || profile.title,
    abstract: input.abstract?.trim() || profile.abstract,
    keywords: input.keywords?.length ? input.keywords : profile.keywords,
    confidence: clamp01(input.confidence ?? (text.length > 1000 ? 0.82 : 0.66)),
    pageCount: input.pageCount,
    warnings,
    sections: profile.sections,
  };
}

function profileText(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = lines.find((line) => {
    const words = line.split(/\s+/).length;
    return line.length >= 8 && line.length <= 220 && words <= 32 && !/^(abstract|keywords?|introduction|references)\b/i.test(line);
  });
  const abstract = sectionByHeading(text, "abstract", ["keywords", "introduction", "background", "1 introduction"]) || firstParagraph(text, title);
  const keywords = keywordsFromText(text);
  const sections = ["abstract", "introduction", "methods", "results", "discussion"]
    .map((label) => ({ label: titleCase(label), text: sectionByHeading(text, label, ["abstract", "keywords", "introduction", "methods", "methodology", "materials and methods", "results", "discussion", "conclusion", "references"]) }))
    .filter((section) => section.text)
    .slice(0, 4) as { label: string; text: string }[];
  return { title, abstract, keywords, sections };
}

function sectionByHeading(text: string, heading: string, stopHeadings: string[]) {
  const lines = text.split("\n");
  const headingPattern = new RegExp(`^\\s*(?:\\d+(?:\\.\\d+)*\\s*)?${escapeRegExp(heading)}\\s*:?\\s*(.*)$`, "i");
  let collecting = false;
  const collected: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting) {
      const match = trimmed.match(headingPattern);
      if (match) {
        collecting = true;
        if (match[1]) collected.push(match[1]);
      }
      continue;
    }
    if (isStopHeading(trimmed, stopHeadings)) break;
    if (trimmed) collected.push(trimmed);
  }

  return collected.join(" ").replace(/\s+/g, " ").trim().slice(0, 4000) || undefined;
}

function isStopHeading(line: string, headings: string[]) {
  if (!line || line.length > 80) return false;
  const cleaned = line.replace(/^\d+(?:\.\d+)*\s*/, "").replace(/:$/, "").toLowerCase();
  return headings.some((heading) => cleaned === heading.toLowerCase()) || /^[A-Z][A-Z\s-]{3,}$/.test(line);
}

function firstParagraph(text: string, title?: string) {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph && paragraph !== title && paragraph.split(/\s+/).length >= 30)
    .at(0)
    ?.slice(0, 2600);
}

function keywordsFromText(text: string) {
  const match = text.match(/\bkey\s*words?\s*[:.-]\s*([^\n]+)/i);
  if (!match) return [];
  return match[1].split(/[,;]/).map((word) => word.trim()).filter(Boolean).slice(0, 10);
}

function keywordsFromPayload(payload: unknown) {
  if (!isRecord(payload)) return [];
  const value = payload.keywords;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 10);
  if (typeof value === "string") return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
  return [];
}

function warningsFromPayload(payload: unknown) {
  if (!isRecord(payload)) return [];
  const value = payload.warnings;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function extractText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) return payload.map(extractText).filter(Boolean).join("\n\n");
  if (!isRecord(payload)) return "";

  for (const key of ["text", "plainText", "markdown", "content", "generated_text", "transcription"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  for (const key of ["data", "result", "output"]) {
    const value = extractText(payload[key]);
    if (value.trim()) return value;
  }

  if (Array.isArray(payload.pages)) {
    return payload.pages.map(extractText).filter(Boolean).join("\n\n");
  }

  return "";
}

function stringFrom(payload: unknown, key: string) {
  return isRecord(payload) && typeof payload[key] === "string" ? payload[key] : undefined;
}

function numberFrom(payload: unknown, key: string) {
  const value = isRecord(payload) ? Number(payload[key]) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function errorText(payload: unknown, raw: string) {
  if (isRecord(payload)) {
    const message = stringFrom(payload, "error") || stringFrom(payload, "message");
    if (message) return message.slice(0, 260);
  }
  return raw.slice(0, 260);
}

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeText(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanFileName(name: string) {
  return name.replace(/[^\w.() -]/g, "_").slice(0, 180) || "manuscript";
}

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function inferMimeType(extension: string) {
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (TEXT_EXTENSIONS.has(extension)) return "text/plain";
  if ([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"].includes(extension)) return `image/${extension.slice(1).replace("jpg", "jpeg")}`;
  return "application/octet-stream";
}

function isTextFile(extension: string, fileType: string) {
  return TEXT_EXTENSIONS.has(extension) || TEXT_TYPES.has(fileType) || fileType.startsWith("text/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
