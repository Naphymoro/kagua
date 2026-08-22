import type { Journal } from "./types";

type JifHit = {
  value: number;
  year: number | null;
  url: string;
  route: "publisher-http" | "hermes-browser";
  confidence: number;
  excerpt: string;
};

type EnrichResult = { journals: Journal[]; publisherHits: number; browserHits: number; attempted: number };

const UA = "Kagua/1.0 (+journal-metrics-evidence; contact=" + (process.env.KAGUA_CONTACT_EMAIL || "not-configured") + ")";
const OA = "https://api.openalex.org";
const DOAJ = "https://doaj.org/api";

function clean(v: unknown) {
  return String(v ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string, timeoutMs = 3500) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.8",
      },
      redirect: "follow",
      signal: c.signal,
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return { text: await r.text(), finalUrl: r.url };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, timeoutMs = 3500) {
  const r = await fetchText(url, timeoutMs);
  return JSON.parse(r.text);
}

function normalizeUrl(v: unknown) {
  const s = String(v ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

function extractJif(raw: string, url: string, route: JifHit["route"]): JifHit | null {
  const text = clean(raw);
  if (!text) return null;
  const lower = text.toLowerCase();
  const anchors = ["journal impact factor", "impact factor"];
  for (const anchor of anchors) {
    let from = 0;
    while (from < lower.length) {
      const i = lower.indexOf(anchor, from);
      if (i < 0) break;
      from = i + anchor.length;
      const windowStart = Math.max(0, i - 90);
      const windowEnd = Math.min(text.length, i + 260);
      const window = text.slice(windowStart, windowEnd);
      const wLower = window.toLowerCase();
      if (/5[ -]?year\s+(journal\s+)?impact\s+factor/.test(wLower)) continue;
      const after = text.slice(i + anchor.length, Math.min(text.length, i + anchor.length + 120));
      const match = after.match(/(?:\s|:|=|–|-)*(?:\(?20\d{2}\)?\s*)?(\d{1,2}(?:\.\d{1,4})?)/);
      if (!match) continue;
      const value = Number(match[1]);
      if (!Number.isFinite(value) || value <= 0 || value > 100) continue;
      const years = window.match(/20\d{2}/g) || [];
      const year = years.length ? Number(years[years.length - 1]) : null;
      return {
        value,
        year: year && year >= 2000 && year <= new Date().getFullYear() + 1 ? year : null,
        url,
        route,
        confidence: route === "hermes-browser" ? 0.94 : 0.91,
        excerpt: window.slice(0, 240),
      };
    }
  }
  return null;
}

async function resolveHomepage(j: Journal): Promise<string | null> {
  const evidenceUrls = (j.evidence || [])
    .map((e) => normalizeUrl(e.url))
    .filter((x): x is string => Boolean(x))
    .filter((u) => !/openalex\.org|crossref\.org|doi\.org|doaj\.org/i.test(u));
  if (evidenceUrls[0]) return evidenceUrls[0];

  if (j.sourceId) {
    try {
      const id = String(j.sourceId).split("/").pop();
      const email = process.env.KAGUA_CONTACT_EMAIL;
      const d = await fetchJson(`${OA}/sources/${id}${email ? `?mailto=${encodeURIComponent(email)}` : ""}`);
      const home = normalizeUrl(d?.homepage_url);
      if (home) return home;
    } catch {}
  }

  for (const issn of j.issns || []) {
    try {
      const d = await fetchJson(`${DOAJ}/search/journals/${encodeURIComponent(`issn:${issn}`)}?pageSize=1`);
      const b = d?.results?.[0]?.bibjson;
      const home = normalizeUrl(b?.ref?.journal || b?.url);
      if (home) return home;
    } catch {}
  }
  return null;
}

async function hermesRender(url: string): Promise<{ text: string; finalUrl: string } | null> {
  const endpoint = process.env.KAGUA_HERMES_BROWSER_URL?.trim();
  if (!endpoint) return null;
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 7000);
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.KAGUA_HERMES_BROWSER_TOKEN
          ? { Authorization: `Bearer ${process.env.KAGUA_HERMES_BROWSER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        url,
        waitForText: ["Impact Factor", "Journal Impact Factor"],
        timeoutMs: 6000,
        textOnly: true,
      }),
      signal: c.signal,
      cache: "no-store",
    });
    if (!r.ok) return null;
    const d = await r.json();
    const text = String(d?.text || d?.content || d?.html || "");
    if (!text) return null;
    return { text, finalUrl: normalizeUrl(d?.url) || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function publisherJif(j: Journal, allowBrowser: boolean): Promise<JifHit | null> {
  const homepage = await resolveHomepage(j);
  if (!homepage) return null;
  const candidates = [homepage];
  try {
    const u = new URL(homepage);
    const origin = u.origin;
    candidates.push(`${origin}/journal-metrics`, `${origin}/about`, `${origin}/journal/about`, `${origin}/aims-and-scope`);
  } catch {}

  for (const url of [...new Set(candidates)].slice(0, 4)) {
    try {
      const page = await fetchText(url);
      const hit = extractJif(page.text, page.finalUrl, "publisher-http");
      if (hit) return hit;
    } catch {}
  }

  if (allowBrowser) {
    const rendered = await hermesRender(homepage);
    if (rendered) {
      const hit = extractJif(rendered.text, rendered.finalUrl, "hermes-browser");
      if (hit) return hit;
    }
  }
  return null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(worker));
  return out;
}

export async function enrichPublisherJif(journals: Journal[]): Promise<EnrichResult> {
  const targets = journals.filter((j) => j.impactFactor == null).slice(0, 80);
  if (!targets.length) return { journals, publisherHits: 0, browserHits: 0, attempted: 0 };

  const hits = await mapLimit(targets, 8, (j, i) => publisherJif(j, i < 24));
  const byId = new Map<string, JifHit>();
  hits.forEach((hit, i) => { if (hit) byId.set(targets[i].id, hit); });

  let publisherHits = 0;
  let browserHits = 0;
  const enriched = journals.map((j) => {
    const hit = byId.get(j.id);
    if (!hit) return j;
    publisherHits += 1;
    if (hit.route === "hermes-browser") browserHits += 1;
    return {
      ...j,
      impactFactor: hit.value,
      impactFactorYear: hit.year ?? j.impactFactorYear,
      evidenceConfidence: Math.min(1, Math.max(j.evidenceConfidence, hit.confidence)),
      evidence: [
        ...(j.evidence || []),
        {
          source: "Publisher" as const,
          field: "journal_impact_factor",
          value: hit.value,
          url: hit.url,
          observedAt: new Date().toISOString(),
          confidence: hit.confidence,
          note: `Official publisher-page JIF evidence recovered via ${hit.route === "hermes-browser" ? "Hermes/browser rendering" : "direct publisher HTTP"}${hit.year ? `; metric year ${hit.year}` : ""}. Excerpt: ${hit.excerpt}`,
        },
      ],
    };
  });

  return { journals: enriched, publisherHits, browserHits, attempted: targets.length };
}
