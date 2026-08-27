"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseCustomJournalList } from "@/lib/kagua/custom-list";
import { PUBLISHER_OPTIONS } from "@/lib/kagua/publishers";
import type {
  AfricaAuthorshipSignal,
  AnalysisResponse,
  CustomJournalList,
  EligibilityPolicy,
  EvidenceItem,
  JournalScore,
  LlmMode,
  LlmProviderId,
  ManuscriptExtraction,
  MetricPreferences,
  Quartile,
  ScoreContribution,
  SimilarWork,
  TrilemmaNode,
} from "@/lib/kagua/types";

type Theme = "light" | "dark";
type Vote = "undecided" | "approve" | "reject";
type Decision = { researcher: Vote; supervisor: Vote; note: string };
type SortKey = "kpos" | "trilemma" | "fit" | "quality" | "affordability" | "speed" | "impactFactor";
type InputMode = "structured" | "upload" | "paste";
type UploadStatus = "idle" | "reading" | "ready" | "error";
type FilterPanelKey = "authority" | "publisher" | "limits" | "engine";
type FilterGroupState = Record<FilterPanelKey, boolean>;
type ManuscriptUploadState = {
  status: UploadStatus;
  fileName: string;
  fileSize: number;
  provider: string;
  message: string;
  confidence?: number;
  warnings: string[];
};
type Draft = {
  title: string;
  abstract: string;
  inputMode: InputMode | "full";
  manuscript: string;
  manuscriptFileName?: string;
  manuscriptProvider?: string;
  keywords: string;
  budget: number;
  days: number;
  metrics: MetricPreferences;
  quartilePreset: string;
  jifMin: string;
  jifMax: string;
  publisherFilters: string[];
  publisherFilter?: string;
  eligibilityPolicy: EligibilityPolicy;
  mode: LlmMode;
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  speedLocked: boolean;
  filterGroups?: FilterGroupState;
};
type FilterSnapshot = {
  budget: number;
  days: number;
  speedLocked: boolean;
  metrics: MetricPreferences;
  quartilePreset: string;
  publisherFilters: string[];
  jifMin: string;
  jifMax: string;
  eligibilityPolicy: EligibilityPolicy;
  customList: CustomJournalList | null;
  mode: LlmMode;
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  keyOpen: boolean;
  filterGroups: FilterGroupState;
};

const DRAFT_KEY = "kagua.hunter.draft.v2";
const defaultFilterGroups = (): FilterGroupState => ({
  authority: false,
  publisher: false,
  limits: false,
  engine: false,
});
const closedFilters = (): Record<FilterPanelKey, boolean> => ({
  authority: false,
  publisher: false,
  limits: false,
  engine: false,
});
const idleManuscriptUpload = (): ManuscriptUploadState => ({
  status: "idle",
  fileName: "",
  fileSize: 0,
  provider: "",
  message: "",
  warnings: [],
});
const manuscriptAccept = ".pdf,.docx,.txt,.md,.markdown,.tex,.png,.jpg,.jpeg,.tif,.tiff,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,image/*";

const providers = [
  {
    id: "deepseek" as LlmProviderId,
    label: "DeepSeek",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "openai" as LlmProviderId,
    label: "OpenAI",
    model: "gpt-5.6-sol",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter" as LlmProviderId,
    label: "OpenRouter",
    model: "deepseek/deepseek-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "custom" as LlmProviderId,
    label: "Custom",
    model: "",
    baseUrl: "",
    keyUrl: "",
  },
];

const quartileOptions: { value: string; label: string; quartiles: Quartile[] }[] = [
  { value: "any", label: "Any quartile", quartiles: [] },
  { value: "Q1", label: "Q1 only", quartiles: ["Q1"] },
  { value: "Q2", label: "Q2 only", quartiles: ["Q2"] },
  { value: "Q3", label: "Q3 only", quartiles: ["Q3"] },
  { value: "Q4", label: "Q4 only", quartiles: ["Q4"] },
  { value: "Q1-Q2", label: "Q1-Q2", quartiles: ["Q1", "Q2"] },
  { value: "Q2-Q3", label: "Q2-Q3", quartiles: ["Q2", "Q3"] },
  { value: "Q3-Q4", label: "Q3-Q4", quartiles: ["Q3", "Q4"] },
  { value: "Q1-Q3", label: "Q1-Q3", quartiles: ["Q1", "Q2", "Q3"] },
  { value: "Q2-Q4", label: "Q2-Q4", quartiles: ["Q2", "Q3", "Q4"] },
  { value: "Q1-Q4", label: "Q1-Q4", quartiles: ["Q1", "Q2", "Q3", "Q4"] },
];

const policyLabels: Record<EligibilityPolicy, string> = {
  dhet: "DHET only",
  custom: "Institution list",
  dhet_or_custom: "DHET or institution",
  all: "Open search",
};

const modeLabels: Record<LlmMode, string> = {
  godmode: "Godmode",
  local: "Local",
  provider: "Provider",
  none: "Scoring",
};

const emptyDecision = (): Decision => ({ researcher: "undecided", supervisor: "undecided", note: "" });

function readDraft() {
  if (typeof window === "undefined") return {} as Partial<Draft>;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : {};
  } catch {
    return {};
  }
}

function normalizeInputMode(value: Partial<Draft>["inputMode"]): InputMode {
  if (value === "full") return "upload";
  return value === "upload" || value === "paste" || value === "structured" ? value : "structured";
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
}

async function readApiJson<T>(response: Response, fallbackError: string): Promise<(T & { error?: string }) | { error?: string }> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return response.ok ? {} : { error: fallbackError };
  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    return {
      error: response.ok
        ? "Kagua received an unreadable response. Please retry the scan."
        : fallbackError,
    };
  }
}

export default function Home() {
  // Every field below starts at a fixed default — the same one the server
  // renders — rather than reading the saved draft during the initial
  // render. Reading localStorage in a useState initializer is exactly what
  // was causing the "hydration failed" error on every reload once a draft
  // existed: the server always renders empty defaults, but the client's
  // first render (which runs during hydration, not after) would read the
  // real saved draft, so nearly every field diverged from what the server
  // sent. The draft is now restored in a mount effect below instead — same
  // one-time-flash tradeoff as the theme restore, and for the same reason:
  // there's no way to know a browser-only value before the client has run.
  const [theme, setTheme] = useState<Theme>("light");
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  // These input modes only control the researcher's editing surface; all
  // routes feed the same title/abstract/manuscript anchors server-side.
  const [inputMode, setInputMode] = useState<InputMode>("structured");
  const [manuscript, setManuscript] = useState("");
  const [manuscriptUpload, setManuscriptUpload] = useState<ManuscriptUploadState>(idleManuscriptUpload);
  const [keywords, setKeywords] = useState("");
  const [budget, setBudget] = useState(2500);
  const [days, setDays] = useState(45);
  const [speedLocked, setSpeedLocked] = useState(false);
  const [metrics, setMetrics] = useState<MetricPreferences>({ apc: true, quartile: true, impactFactor: true });
  const [quartilePreset, setQuartilePreset] = useState("any");
  const [publisherFilters, setPublisherFilters] = useState<string[]>([]);
  const [jifMin, setJifMin] = useState("");
  const [jifMax, setJifMax] = useState("");
  const [eligibilityPolicy, setEligibilityPolicy] = useState<EligibilityPolicy>("dhet");
  const [customList, setCustomList] = useState<CustomJournalList | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [mode, setMode] = useState<LlmMode>("godmode");
  const [provider, setProvider] = useState<LlmProviderId>("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [model, setModel] = useState("deepseek-chat");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  // Every fetched batch is kept (not overwritten), so "back"/"forward" can
  // revisit an already-seen batch instantly instead of losing it the
  // moment "Show next 5" runs. `data`/`batch` are derived from this rather
  // than being their own state, so every place that already reads them
  // keeps working unchanged.
  const [history, setHistory] = useState<AnalysisResponse[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const data = historyIndex >= 0 ? history[historyIndex] : null;
  const batch = historyIndex + 1;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [view, setView] = useState<"recommendations" | "explorer">("recommendations");
  const [openFilters, setOpenFilters] = useState<Record<FilterPanelKey, boolean>>(closedFilters);
  const [filterSnapshot, setFilterSnapshot] = useState<FilterSnapshot | null>(null);
  const [filterGroups, setFilterGroups] = useState<FilterGroupState>(defaultFilterGroups);
  const [sort, setSort] = useState<SortKey>("kpos");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    // One-time sync from the pre-paint script's DOM state (or localStorage
    // as a fallback) into React state, so the toggle button's label matches
    // reality after mount. This necessarily runs after first paint — there
    // is no way to know a browser-only value before the client has run —
    // so it's the standard, accepted exception to "don't setState in an
    // effect on mount"; the alternative is server-side cookie plumbing for
    // theme, which is a larger change than this pass is scoped for.
    try {
      const applied = document.documentElement.dataset.theme;
      const saved = applied || localStorage.getItem("kagua.theme");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "dark") setTheme("dark");
    } catch {}
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- restoring a browser-only
     value (localStorage) after mount, matching the server's empty-form
     render on first paint; see the comment on the state declarations above. */
  useEffect(() => {
    const draft = readDraft();
    if (draft.title) setTitle(draft.title);
    if (draft.abstract) setAbstract(draft.abstract);
    const restoredMode = normalizeInputMode(draft.inputMode);
    if (draft.inputMode) setInputMode(restoredMode);
    if (draft.manuscript) {
      setManuscript(draft.manuscript);
      if (restoredMode === "upload") {
        setManuscriptUpload({
          status: "ready",
          fileName: draft.manuscriptFileName || "Saved manuscript extraction",
          fileSize: draft.manuscript.length,
          provider: draft.manuscriptProvider || "saved draft",
          message: "Extracted text restored from this browser.",
          warnings: [],
        });
      }
    }
    if (draft.keywords) setKeywords(draft.keywords);
    if (draft.budget != null) setBudget(draft.budget);
    if (draft.days != null) setDays(draft.days);
    if (draft.speedLocked) setSpeedLocked(Boolean(draft.speedLocked));
    if (draft.metrics) setMetrics(draft.metrics);
    if (draft.quartilePreset) setQuartilePreset(draft.quartilePreset);
    if (Array.isArray(draft.publisherFilters)) {
      setPublisherFilters(draft.publisherFilters.filter(Boolean));
    } else if (draft.publisherFilter) {
      setPublisherFilters([draft.publisherFilter]);
    }
    if (draft.jifMin) setJifMin(draft.jifMin);
    if (draft.jifMax) setJifMax(draft.jifMax);
    if (draft.eligibilityPolicy) setEligibilityPolicy(draft.eligibilityPolicy);
    if (draft.mode) setMode(draft.mode);
    if (draft.provider) setProvider(draft.provider);
    if (draft.model) setModel(draft.model);
    if (draft.baseUrl) setBaseUrl(draft.baseUrl);
    if (draft.filterGroups) setFilterGroups({ ...defaultFilterGroups(), ...draft.filterGroups });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("kagua.theme", theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    const draft: Draft = {
      title,
      abstract,
      inputMode,
      manuscript,
      manuscriptFileName: manuscriptUpload.fileName,
      manuscriptProvider: manuscriptUpload.provider,
      keywords,
      budget,
      days,
      metrics,
      quartilePreset,
      publisherFilters,
      publisherFilter: publisherFilters[0] || "",
      jifMin,
      jifMax,
      eligibilityPolicy,
      mode,
      provider,
      model,
      baseUrl,
      speedLocked,
      filterGroups,
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [
    abstract,
    inputMode,
    manuscript,
    manuscriptUpload.fileName,
    manuscriptUpload.provider,
    baseUrl,
    budget,
    days,
    eligibilityPolicy,
    filterGroups,
    jifMax,
    jifMin,
    keywords,
    metrics,
    mode,
    model,
    provider,
    quartilePreset,
    publisherFilters,
    speedLocked,
    title,
  ]);

  const p = providers.find((x) => x.id === provider) || providers[0];
  const keywordList = useMemo(() => keywords.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean), [keywords]);
  const selectedQuartiles = quartileOptions.find((x) => x.value === quartilePreset)?.quartiles || [];
  const selectedPublisherLabels = useMemo(
    () => publisherFilters.map((value) => PUBLISHER_OPTIONS.find((option) => option.value === value)?.label || value),
    [publisherFilters],
  );
  const publisherSummary = selectedPublisherLabels.length
    ? selectedPublisherLabels.length === 1
      ? selectedPublisherLabels[0]
      : `${selectedPublisherLabels.length} publishers`
    : "Any publisher";
  const jifSummary =
    jifMin && jifMax ? `${jifMin}-${jifMax}` : jifMin ? `>= ${jifMin}` : jifMax ? `<= ${jifMax}` : "";
  const limitSummary = [
    metrics.apc ? `APC <= $${budget.toLocaleString()}` : "",
    metrics.quartile && selectedQuartiles.length ? quartilePreset : "",
    metrics.impactFactor && jifSummary ? `JIF ${jifSummary}` : "",
    speedLocked ? `Decision <= ${days} days` : "",
  ].filter(Boolean).join(" · ") || "Metrics as signals";
  const appliedPolicySummary = filterGroups.authority ? policyLabels[eligibilityPolicy] : "Not applied";
  const appliedPublisherSummary = filterGroups.publisher ? publisherSummary : "Not applied";
  const appliedLimitSummary = filterGroups.limits ? limitSummary : "Not applied";
  const appliedEngineSummary = filterGroups.engine ? modeLabels[mode] : "Off";
  const abstractWords = useMemo(() => abstract.trim().split(/\s+/).filter(Boolean).length, [abstract]);
  const manuscriptWords = useMemo(() => manuscript.trim().split(/\s+/).filter(Boolean).length, [manuscript]);
  const readiness = useMemo(() => {
    let score = 0;
    if (inputMode === "structured") {
      if (title.trim().length > 12) score += 32;
      if (abstractWords >= 80) score += 38;
    } else {
      if (manuscript.trim().length > 40) score += 32;
      if (manuscriptWords >= 150) score += 38;
      if (inputMode === "upload" && manuscriptUpload.status === "ready") score += 8;
    }
    if (keywordList.length >= 3) score += 16;
    if (!filterGroups.authority || eligibilityPolicy === "dhet" || customList || eligibilityPolicy === "all") score += 14;
    return Math.min(100, score);
  }, [abstractWords, customList, eligibilityPolicy, filterGroups.authority, inputMode, keywordList.length, manuscript, manuscriptUpload.status, manuscriptWords, title]);
  const table = useMemo(
    () => [...(data?.rankingExplorer || [])].sort((a, b) => Number(b[sort] || 0) - Number(a[sort] || 0)),
    [data, sort],
  );
  const selectedJournals = useMemo(
    () => selectedIds.map((id) => data?.journals.find((j) => j.id === id)).filter(Boolean) as JournalScore[],
    [data?.journals, selectedIds],
  );
  const consensusJournal = useMemo(
    () => data?.journals.find((j) => decisions[j.id]?.researcher === "approve" && decisions[j.id]?.supervisor === "approve"),
    [data?.journals, decisions],
  );
  const decisionCounts = useMemo(() => {
    const rows = data?.journals || [];
    return rows.reduce(
      (acc, journal) => {
        const d = decisions[journal.id] || emptyDecision();
        if (d.researcher === "approve" || d.supervisor === "approve") acc.signals += 1;
        if (d.researcher === "reject" && d.supervisor === "reject") acc.rejected += 1;
        if (d.researcher === "undecided" || d.supervisor === "undecided") acc.open += 1;
        return acc;
      },
      { signals: 0, rejected: 0, open: 0 },
    );
  }, [data?.journals, decisions]);

  function chooseProvider(id: LlmProviderId) {
    setProvider(id);
    const nextProvider = providers.find((v) => v.id === id);
    if (nextProvider) {
      setModel(nextProvider.model);
      setBaseUrl(nextProvider.baseUrl);
    }
  }

  function addPublisherFilter(value: string) {
    if (!value) return;
    setFilterGroupActive("publisher", true);
    setPublisherFilters((current) => (current.includes(value) ? current : [...current, value]));
  }

  function removePublisherFilter(value: string) {
    setPublisherFilters((current) => current.filter((item) => item !== value));
  }

  function captureFilterSnapshot(): FilterSnapshot {
    return {
      budget,
      days,
      speedLocked,
      metrics: { ...metrics },
      quartilePreset,
      publisherFilters: [...publisherFilters],
      jifMin,
      jifMax,
      eligibilityPolicy,
      customList,
      mode,
      provider,
      model,
      baseUrl,
      keyOpen,
      filterGroups,
    };
  }

  function restoreFilterSnapshot(snapshot: FilterSnapshot) {
    setBudget(snapshot.budget);
    setDays(snapshot.days);
    setSpeedLocked(snapshot.speedLocked);
    setMetrics(snapshot.metrics);
    setQuartilePreset(snapshot.quartilePreset);
    setPublisherFilters(snapshot.publisherFilters);
    setJifMin(snapshot.jifMin);
    setJifMax(snapshot.jifMax);
    setEligibilityPolicy(snapshot.eligibilityPolicy);
    setCustomList(snapshot.customList);
    setMode(snapshot.mode);
    setProvider(snapshot.provider);
    setModel(snapshot.model);
    setBaseUrl(snapshot.baseUrl);
    setKeyOpen(snapshot.keyOpen);
    setFilterGroups(snapshot.filterGroups);
  }

  function setFilterGroupActive(key: FilterPanelKey, enabled: boolean) {
    setFilterGroups((current) => ({ ...current, [key]: enabled }));
    if (enabled && key === "authority" && eligibilityPolicy === "all") setEligibilityPolicy("dhet");
    if (enabled && key === "engine" && mode === "none") setMode("godmode");
  }

  function closeFilterPanel() {
    if (filterSnapshot) restoreFilterSnapshot(filterSnapshot);
    setOpenFilters(closedFilters());
    setFilterSnapshot(null);
  }

  function applyFilterPanel() {
    setOpenFilters(closedFilters());
    setFilterSnapshot(null);
  }

  function openFilterPanel(key: FilterPanelKey) {
    if (openFilters[key]) {
      closeFilterPanel();
      return;
    }
    const snapshot = filterSnapshot || captureFilterSnapshot();
    if (filterSnapshot) restoreFilterSnapshot(filterSnapshot);
    setFilterSnapshot(snapshot);
    setOpenFilters({ ...closedFilters(), [key]: true });
  }

  function setDhetRequirement(enabled: boolean) {
    const usesCustom = eligibilityPolicy === "custom" || eligibilityPolicy === "dhet_or_custom";
    if (enabled) {
      setEligibilityPolicy(usesCustom ? "dhet_or_custom" : "dhet");
    } else {
      setEligibilityPolicy(usesCustom ? "custom" : "all");
    }
  }

  function setCustomRequirement(enabled: boolean) {
    if (!customList && enabled) return;
    const usesDhet = eligibilityPolicy === "dhet" || eligibilityPolicy === "dhet_or_custom";
    if (enabled) {
      setEligibilityPolicy(usesDhet ? "dhet_or_custom" : "custom");
    } else {
      setEligibilityPolicy(usesDhet ? "dhet" : "all");
    }
  }

  function resetFilters() {
    setEligibilityPolicy("dhet");
    setCustomList(null);
    setPublisherFilters([]);
    setBudget(2500);
    setDays(45);
    setSpeedLocked(false);
    setMetrics({ apc: true, quartile: true, impactFactor: true });
    setQuartilePreset("any");
    setJifMin("");
    setJifMax("");
    setMode("godmode");
    chooseProvider("deepseek");
    setKeyOpen(false);
    setOpenFilters(closedFilters());
    setFilterSnapshot(null);
    setFilterGroups(defaultFilterGroups());
    setError("");
  }

  function clearDraft() {
    setTitle("");
    setAbstract("");
    setManuscript("");
    setManuscriptUpload(idleManuscriptUpload());
    setInputMode("structured");
    setKeywords("");
    setBudget(2500);
    setDays(45);
    setSpeedLocked(false);
    setMetrics({ apc: true, quartile: true, impactFactor: true });
    setPublisherFilters([]);
    setQuartilePreset("any");
    setJifMin("");
    setJifMax("");
    setEligibilityPolicy("dhet");
    setCustomList(null);
    setHistory([]);
    setHistoryIndex(-1);
    setSeen([]);
    setDecisions({});
    setSelectedIds([]);
    setOpenFilters(closedFilters());
    setFilterSnapshot(null);
    setFilterGroups(defaultFilterGroups());
    setError("");
  }

  function fillDemo() {
    setInputMode("structured");
    setManuscriptUpload(idleManuscriptUpload());
    setTitle("Single-atom catalysts on ceria for low-temperature ammonia decomposition");
    setAbstract(
      "This manuscript reports density functional theory and microkinetic analysis of transition-metal single atom catalysts anchored on defective ceria surfaces for low-temperature ammonia decomposition. The study compares nitrogen vacancy formation, hydrogen spillover, N-H bond activation barriers, and catalyst stability across multiple dopants. The work combines mechanistic modelling with materials screening to identify affordable catalyst motifs for green hydrogen carrier systems.",
    );
    setKeywords("ammonia decomposition, ceria, single-atom catalyst, DFT, green hydrogen");
    setBudget(1800);
    setDays(50);
  }

  async function uploadList(file: File | null) {
    if (!file) return;
    setListBusy(true);
    setError("");
    try {
      const parsed = await parseCustomJournalList(file);
      if (!parsed.entries.length) throw new Error("No journal titles or ISSNs were detected in that file.");
      setCustomList(parsed);
      setEligibilityPolicy("custom");
      setFilterGroupActive("authority", true);
    } catch (e) {
      setCustomList(null);
      setError(e instanceof Error ? e.message : "Could not parse the journal list.");
    } finally {
      setListBusy(false);
    }
  }

  async function uploadManuscriptFile(file: File | null) {
    if (!file) return;
    setInputMode("upload");
    setError("");
    setManuscriptUpload({
      status: "reading",
      fileName: file.name,
      fileSize: file.size,
      provider: "OCR",
      message: "Reading manuscript file...",
      warnings: [],
    });
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/manuscript/extract", { method: "POST", body: form });
      const body = await readApiJson<Partial<ManuscriptExtraction>>(response, "Could not extract manuscript text.");
      if (!response.ok) throw new Error(body.error || "Could not extract manuscript text.");
      if (!("text" in body) || typeof body.text !== "string" || !body.text.trim()) {
        throw new Error(body.error || "The extractor did not return readable manuscript text.");
      }
      const extraction = body as ManuscriptExtraction;
      const extractedWords = extraction.text.trim().split(/\s+/).filter(Boolean).length;
      setManuscript(extraction.text);
      if (!title.trim() && extraction.title) setTitle(extraction.title);
      if (!abstract.trim() && extraction.abstract) setAbstract(extraction.abstract);
      if (!keywords.trim() && extraction.keywords?.length) setKeywords(extraction.keywords.join(", "));
      setManuscriptUpload({
        status: "ready",
        fileName: extraction.fileName,
        fileSize: extraction.fileSize,
        provider: extraction.provider,
        confidence: extraction.confidence,
        message: `${extractedWords.toLocaleString()} words extracted`,
        warnings: extraction.warnings || [],
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not extract manuscript text.";
      setManuscriptUpload((current) => ({ ...current, status: "error", message }));
      setError(message);
    }
  }

  function payload(exclude: string[], selectedMode: LlmMode) {
    const effectiveEligibilityPolicy = filterGroups.authority ? eligibilityPolicy : "all";
    const effectiveMetrics: MetricPreferences = filterGroups.limits ? metrics : { apc: false, quartile: false, impactFactor: false };
    const effectivePublisherFilters = filterGroups.publisher ? publisherFilters : [];
    const llm =
      selectedMode === "provider"
        ? { mode: selectedMode, provider, apiKey, model, baseUrl }
        : selectedMode === "godmode" && apiKey
          ? { mode: selectedMode, providers: [{ id: provider, apiKey, model, baseUrl, enabled: true }] }
          : { mode: selectedMode };

    return {
      title,
      abstract,
      manuscript,
      keywords: keywordList,
      budgetUsd: budget,
      desiredDays: days,
      dhetOnly: filterGroups.authority && eligibilityPolicy === "dhet",
      eligibilityPolicy: effectiveEligibilityPolicy,
      customJournalList: filterGroups.authority ? customList || undefined : undefined,
      metricPreferences: effectiveMetrics,
      constraintLocks: {
        dhet: filterGroups.authority,
        apc: filterGroups.limits && metrics.apc,
        quartile: filterGroups.limits && metrics.quartile,
        impactFactor: filterGroups.limits && metrics.impactFactor,
        speed: filterGroups.limits && speedLocked,
      },
      quartileSelection: filterGroups.limits && metrics.quartile ? selectedQuartiles : [],
      impactFactorMin: filterGroups.limits && metrics.impactFactor && jifMin !== "" ? Number(jifMin) : null,
      impactFactorMax: filterGroups.limits && metrics.impactFactor && jifMax !== "" ? Number(jifMax) : null,
      publisherFilters: effectivePublisherFilters,
      publisherFilter: effectivePublisherFilters[0] || null,
      excludeJournalIds: exclude,
      batchSize: 5,
      explorerSize: 50,
      llm,
    };
  }

  async function run(exclude: string[], selectedMode: LlmMode) {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(exclude, selectedMode)),
    });
    const fallbackError = response.ok
      ? "Kagua received an empty scan response. Please retry the scan."
      : `Kagua scan failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""}). Please adjust the filters or retry.`;
    const body = await readApiJson<AnalysisResponse>(response, fallbackError);
    if (!response.ok) throw new Error(body.error || fallbackError);
    if (!("journals" in body) || !Array.isArray(body.journals)) {
      throw new Error(body.error || "Kagua returned an empty analysis response. Please retry the scan.");
    }
    return body as AnalysisResponse;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (filterGroups.authority && (eligibilityPolicy === "custom" || eligibilityPolicy === "dhet_or_custom") && !customList) {
        throw new Error("Upload a university or institution journal list before using this eligibility policy.");
      }
      const response = await run([], filterGroups.engine ? (mode === "local" ? "none" : mode) : "none");
      setHistory([response]);
      setHistoryIndex(0);
      setSeen(response.journals.map((j) => j.id));
      setView("recommendations");
      setSelectedIds(response.journals.slice(0, 2).map((j) => j.id));
      setDecisions(Object.fromEntries(response.journals.map((j) => [j.id, emptyDecision()])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const exclude = [...new Set([...seen, ...data.journals.map((j) => j.id)])];
      const response = await run(exclude, "none");
      // Fetching a new batch always extends from the current position, not
      // from wherever "history" happened to end — if the researcher went
      // back and then asks for a new batch, that discards any batches
      // ahead of here, same as a browser would after back + a fresh
      // navigation.
      setHistory((h) => [...h.slice(0, historyIndex + 1), response]);
      setHistoryIndex((i) => i + 1);
      setSeen([...new Set([...exclude, ...response.journals.map((j) => j.id)])]);
      setSelectedIds(response.journals.slice(0, 2).map((j) => j.id));
      setDecisions((state) => ({
        ...state,
        ...Object.fromEntries(response.journals.map((j) => [j.id, state[j.id] || emptyDecision()])),
      }));
      setView("recommendations");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No more matching journals");
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (historyIndex <= 0) return;
    setHistoryIndex((i) => i - 1);
    setView("recommendations");
  }

  function goForward() {
    if (historyIndex >= history.length - 1) return;
    setHistoryIndex((i) => i + 1);
    setView("recommendations");
  }

  function toggleSelected(id: string) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-4)));
  }

  // A title alone, an abstract alone, or extracted/uploaded manuscript text is
  // enough to search on, whichever the researcher actually has.
  const canSubmit = Boolean(
    (inputMode === "structured" ? title.trim() || abstract.trim() : manuscript.trim()) && !busy,
  );
  return (
    <main className="shell hunterShell">
      <section className="hero productHero">
        <div>
          <span className="eyebrow">SCOPE-FIRST PUBLICATION INTELLIGENCE</span>
          <h1>
            Find the journal your science <em>belongs in.</em>
          </h1>
          <p>
            Kagua turns a manuscript into an auditable journal shortlist: evidence first, eligibility explicit, and
            researcher-supervisor decisions kept visible.
          </p>
        </div>
        <div className="heroDeck" aria-label="Kagua operating status">
          <HeroMetric label="Authority" value={appliedPolicySummary} />
          <HeroMetric label="Readiness" value={`${readiness}%`} />
          <HeroMetric label="Publisher" value={appliedPublisherSummary} />
          <HeroMetric label="Batch" value={data ? `Top ${data.journals.length}` : "Ready"} />
          <button type="button" className="heroTheme" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </section>

      <section className="hunterWorkspace">
        <form className="searchForm" onSubmit={submit}>
          <ManuscriptCard
            inputMode={inputMode}
            setInputMode={setInputMode}
            title={title}
            setTitle={setTitle}
            abstract={abstract}
            setAbstract={setAbstract}
            manuscript={manuscript}
            setManuscript={setManuscript}
            uploadState={manuscriptUpload}
            onUpload={uploadManuscriptFile}
            keywords={keywords}
            setKeywords={setKeywords}
            abstractWords={abstractWords}
            manuscriptWords={manuscriptWords}
            keywordCount={keywordList.length}
            onDemo={fillDemo}
            onFilters={() => openFilterPanel("authority")}
            canSubmit={canSubmit}
            busy={busy}
            readiness={readiness}
            publisherSummary={appliedPublisherSummary}
            policy={appliedPolicySummary}
            error={error}
          >
            <section id="journal-filters" className="refinementDock" aria-label="Journal search refinements">
              <div className="refinementRail">
                <div className="refinementTitle">
                  <span className="eyebrow">REFINE SEARCH</span>
                  <b>{data ? `Batch ${batch} settings` : "Optional before scan"}</b>
                </div>
                <div className="activeFilterBar refinementChips" aria-label="Active search refinements">
                  <span className={`activeFilter ${filterGroups.authority ? "fixed" : "mutedFilter"}`}>
                    <b>Authority</b>
                    {appliedPolicySummary}
                  </span>
                  {filterGroups.publisher && publisherFilters.length ? (
                    publisherFilters.map((value) => {
                      const label = PUBLISHER_OPTIONS.find((option) => option.value === value)?.label || value;
                      return (
                        <button
                          type="button"
                          key={value}
                          className="activeFilter removable"
                          onClick={() => removePublisherFilter(value)}
                          aria-label={`Remove publisher filter ${label}`}
                        >
                          <b>Publisher</b>
                          {label}
                          <i aria-hidden="true">x</i>
                        </button>
                      );
                    })
                  ) : (
                    <span className="activeFilter mutedFilter">
                      <b>Publisher</b>
                      {appliedPublisherSummary}
                    </span>
                  )}
                  <span className={`activeFilter ${filterGroups.limits ? "fixed" : "mutedFilter"}`}>
                    <b>Limits</b>
                    {appliedLimitSummary}
                  </span>
                  <span className={`activeFilter ${filterGroups.engine ? "fixed" : "mutedFilter"}`}>
                    <b>Engine</b>
                    {appliedEngineSummary}
                  </span>
                </div>
                <div className="filterActions refinementActions">
                  <button type="button" className="textButton" onClick={resetFilters}>
                    Reset
                  </button>
                  <button type="button" className="textButton" onClick={clearDraft}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="refinementMenus" aria-label="Refinement controls">
                <div className={`refineMenu ${openFilters.authority ? "isOpen" : ""} ${filterGroups.authority ? "hasApplied" : ""}`}>
                  <div className="refineMenuCard">
                    <label className="refineMenuApply" title="Apply Authority filter">
                      <input
                        type="checkbox"
                        checked={filterGroups.authority}
                        onChange={(e) => setFilterGroupActive("authority", e.target.checked)}
                        aria-label="Apply Authority filter"
                      />
                    </label>
                    <button
                      type="button"
                      className="refineMenuButton"
                      aria-expanded={openFilters.authority}
                      onClick={() => openFilterPanel("authority")}
                    >
                      <span>
                        <b>Authority</b>
                        <small>{appliedPolicySummary}</small>
                      </span>
                      <i>{openFilters.authority ? "Editing" : "Edit"}</i>
                    </button>
                  </div>
                  {openFilters.authority && (
                    <div className="refineMenuPanel">
                      <label className="checkRow optionCheck parentOption">
                        <input
                          type="checkbox"
                          checked={filterGroups.authority}
                          onChange={(e) => setFilterGroupActive("authority", e.target.checked)}
                        />
                        <span>
                          <b>Apply Authority filter</b>
                          <small>When unchecked, Kagua uses open eligibility and ignores the nested authority choices.</small>
                        </span>
                      </label>
                      <div className={`nestedCriteria ${filterGroups.authority ? "" : "isMuted"}`}>
                        <label className="checkRow optionCheck">
                          <input
                            type="checkbox"
                            checked={eligibilityPolicy === "dhet" || eligibilityPolicy === "dhet_or_custom"}
                            onChange={(e) => setDhetRequirement(e.target.checked)}
                          />
                          <span>
                            <b>Include DHET recognition</b>
                            <small>Use the current official DHET list as an eligibility gate.</small>
                          </span>
                        </label>
                        <label className={`checkRow optionCheck ${!customList ? "disabledOption" : ""}`}>
                          <input
                            type="checkbox"
                            checked={(eligibilityPolicy === "custom" || eligibilityPolicy === "dhet_or_custom") && Boolean(customList)}
                            disabled={!customList}
                            onChange={(e) => setCustomRequirement(e.target.checked)}
                          />
                          <span>
                            <b>Include uploaded institution list</b>
                            <small>{customList ? "Use your uploaded list as another eligibility source." : "Upload a list below to enable this option."}</small>
                          </span>
                        </label>
                      </div>
                      <label>
                        Policy preset
                        <select value={eligibilityPolicy} onChange={(e) => setEligibilityPolicy(e.target.value as EligibilityPolicy)}>
                          <option value="dhet">DHET only (default)</option>
                          <option value="custom">University/institution list only</option>
                          <option value="dhet_or_custom">DHET OR uploaded list</option>
                          <option value="all">Open search</option>
                        </select>
                      </label>
                      <div className="authorityPanel">
                        <div>
                          <b>{policyLabels[eligibilityPolicy]}</b>
                          <span>
                            {customList
                              ? `${customList.entries.length.toLocaleString()} uploaded records available`
                              : "Official DHET recognition remains the default gate."}
                          </span>
                        </div>
                        <Link href="/registry" className="secondaryButton">
                          DHET list
                        </Link>
                      </div>
                      <label>
                        Upload institution journal list
                        <small className="hint">
                          XLSX, XLS, CSV, TSV or TXT. Include Impact Factor / Quartile columns and Kagua treats them as
                          verified metrics.
                        </small>
                        <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" onChange={(e) => uploadList(e.target.files?.[0] || null)} />
                      </label>
                      {listBusy && <p className="evidence">Reading uploaded journal list...</p>}
                      {customList && (
                        <div className="uploadSummary">
                          <span>{customList.name}</span>
                          <b>{customList.entries.length.toLocaleString()} journals</b>
                          <button
                            type="button"
                            className="textButton"
                            onClick={() => {
                              setCustomList(null);
                              setEligibilityPolicy("dhet");
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                      <FilterPanelFooter applyLabel="Save authority choices" onApply={applyFilterPanel} onClose={closeFilterPanel} />
                    </div>
                  )}
                </div>

                <div className={`refineMenu ${openFilters.publisher ? "isOpen" : ""} ${filterGroups.publisher ? "hasApplied" : ""}`}>
                  <div className="refineMenuCard">
                    <label className="refineMenuApply" title="Apply Publisher filter">
                      <input
                        type="checkbox"
                        checked={filterGroups.publisher}
                        onChange={(e) => setFilterGroupActive("publisher", e.target.checked)}
                        aria-label="Apply Publisher filter"
                      />
                    </label>
                    <button
                      type="button"
                      className="refineMenuButton"
                      aria-expanded={openFilters.publisher}
                      onClick={() => openFilterPanel("publisher")}
                    >
                      <span>
                        <b>Publisher</b>
                        <small>{appliedPublisherSummary}</small>
                      </span>
                      <i>{openFilters.publisher ? "Editing" : "Edit"}</i>
                    </button>
                  </div>
                  {openFilters.publisher && (
                    <div className="refineMenuPanel">
                      <label className="checkRow optionCheck parentOption">
                        <input
                          type="checkbox"
                          checked={filterGroups.publisher}
                          onChange={(e) => setFilterGroupActive("publisher", e.target.checked)}
                        />
                        <span>
                          <b>Apply Publisher filter</b>
                          <small>When unchecked, selected publisher chips are saved but ignored by the scan.</small>
                        </span>
                      </label>
                      <div className={`nestedCriteria ${filterGroups.publisher ? "" : "isMuted"}`}>
                      <label>
                        Add publisher groups
                        <select
                          value=""
                          onChange={(e) => {
                            addPublisherFilter(e.target.value);
                          }}
                        >
                          <option value="">Any publisher, or choose to add...</option>
                          {PUBLISHER_OPTIONS.filter((option) => !publisherFilters.includes(option.value)).map((x) => (
                            <option key={x.value} value={x.value}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                        <small className="hint">
                          Groups legal-entity variants together, so publisher filtering matches the group.
                        </small>
                      </label>
                      <div className={publisherFilters.length ? "publisherChips" : "publisherEmpty"}>
                        {publisherFilters.length ? (
                          <>
                            {publisherFilters.map((value) => {
                              const label = PUBLISHER_OPTIONS.find((option) => option.value === value)?.label || value;
                              return (
                                <button
                                  type="button"
                                  key={value}
                                  className="publisherChip"
                                  onClick={() => removePublisherFilter(value)}
                                  aria-label={`Remove ${label}`}
                                >
                                  <span>{label}</span>
                                  <i aria-hidden="true">x</i>
                                </button>
                              );
                            })}
                            <button type="button" className="textButton clearPublishers" onClick={() => setPublisherFilters([])}>
                              Clear all
                            </button>
                          </>
                        ) : (
                          <span>All publisher groups are included unless you add one or more here.</span>
                        )}
                      </div>
                      {publisherFilters.length > 0 && (
                        <div className="filterSummary">
                          <div>
                            <b>Matching any selected publisher</b>
                            <span>Kagua will keep journals from {selectedPublisherLabels.join(", ")} and exclude the rest.</span>
                          </div>
                        </div>
                      )}
                      </div>
                      <FilterPanelFooter applyLabel="Save publisher choices" onApply={applyFilterPanel} onClose={closeFilterPanel} />
                    </div>
                  )}
                </div>

                <div className={`refineMenu ${openFilters.limits ? "isOpen" : ""} ${filterGroups.limits ? "hasApplied" : ""}`}>
                  <div className="refineMenuCard">
                    <label className="refineMenuApply" title="Apply Limits filter">
                      <input
                        type="checkbox"
                        checked={filterGroups.limits}
                        onChange={(e) => setFilterGroupActive("limits", e.target.checked)}
                        aria-label="Apply Limits filter"
                      />
                    </label>
                    <button
                      type="button"
                      className="refineMenuButton"
                      aria-expanded={openFilters.limits}
                      onClick={() => openFilterPanel("limits")}
                    >
                      <span>
                        <b>Limits</b>
                        <small>{appliedLimitSummary}</small>
                      </span>
                      <i>{openFilters.limits ? "Editing" : "Edit"}</i>
                    </button>
                  </div>
                  {openFilters.limits && (
                    <div className="refineMenuPanel">
                      <label className="checkRow optionCheck parentOption">
                        <input
                          type="checkbox"
                          checked={filterGroups.limits}
                          onChange={(e) => setFilterGroupActive("limits", e.target.checked)}
                        />
                        <span>
                          <b>Apply Limits filter</b>
                          <small>When unchecked, APC, quartile, JIF, and decision-time settings are saved but ignored.</small>
                        </span>
                      </label>
                      <div className={`nestedCriteria ${filterGroups.limits ? "" : "isMuted"}`}>
                      <div className="metricAccordion">
                        <MetricRow label="APC" checked={metrics.apc} onChange={(v) => setMetrics({ ...metrics, apc: v })}>
                          <label>
                            Maximum APC (USD)
                            <input type="number" min="0" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
                          </label>
                        </MetricRow>
                        <MetricRow label="Quartile" checked={metrics.quartile} onChange={(v) => setMetrics({ ...metrics, quartile: v })}>
                          <label>
                            Allowed quartile range
                            <select value={quartilePreset} onChange={(e) => setQuartilePreset(e.target.value)}>
                              {quartileOptions.map((x) => (
                                <option key={x.value} value={x.value}>
                                  {x.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </MetricRow>
                        <MetricRow
                          label="Impact Factor"
                          checked={metrics.impactFactor}
                          onChange={(v) => setMetrics({ ...metrics, impactFactor: v })}
                        >
                          <div className="grid2">
                            <label>
                              Minimum JIF
                              <input type="number" min="0" step="0.1" value={jifMin} onChange={(e) => setJifMin(e.target.value)} />
                            </label>
                            <label>
                              Maximum JIF
                              <input type="number" min="0" step="0.1" value={jifMax} onChange={(e) => setJifMax(e.target.value)} />
                            </label>
                          </div>
                        </MetricRow>
                      </div>
                      <label>
                        Desired first decision
                        <span className="rangeMeta">{days} days</span>
                        <input type="range" min="7" max="120" value={days} onChange={(e) => setDays(Number(e.target.value))} />
                      </label>
                      <label className="checkRow lockRow">
                        <input type="checkbox" checked={speedLocked} onChange={(e) => setSpeedLocked(e.target.checked)} />
                        <span>
                          <b>Use decision time as a hard filter</b>
                          <small>Otherwise speed remains a pathway signal, not an exclusion rule.</small>
                        </span>
                      </label>
                      </div>
                      <FilterPanelFooter applyLabel="Save limit choices" onApply={applyFilterPanel} onClose={closeFilterPanel} />
                    </div>
                  )}
                </div>

                <div className={`refineMenu advancedRefineMenu ${openFilters.engine ? "isOpen" : ""} ${filterGroups.engine ? "hasApplied" : ""}`}>
                  <div className="refineMenuCard">
                    <label className="refineMenuApply" title="Apply Advanced engine">
                      <input
                        type="checkbox"
                        checked={filterGroups.engine}
                        onChange={(e) => setFilterGroupActive("engine", e.target.checked)}
                        aria-label="Apply Advanced engine"
                      />
                    </label>
                    <button
                      type="button"
                      className="refineMenuButton"
                      aria-expanded={openFilters.engine}
                      onClick={() => openFilterPanel("engine")}
                    >
                      <span>
                        <b>Advanced engine</b>
                        <small>{appliedEngineSummary}</small>
                      </span>
                      <i>{openFilters.engine ? "Editing" : "Edit"}</i>
                    </button>
                  </div>
                  {openFilters.engine && (
                    <div className="refineMenuPanel">
                      <label className="checkRow optionCheck parentOption">
                        <input
                          type="checkbox"
                          checked={filterGroups.engine}
                          onChange={(e) => setFilterGroupActive("engine", e.target.checked)}
                        />
                        <span>
                          <b>Apply Advanced engine</b>
                          <small>When unchecked, Kagua uses deterministic scoring and ignores provider/model choices.</small>
                        </span>
                      </label>
                      <div className={`nestedCriteria ${filterGroups.engine ? "" : "isMuted"}`}>
                      <div className="segmented four engineModes" aria-label="LLM mode">
                        {(["godmode", "local", "provider", "none"] as LlmMode[]).map((x) => (
                          <button type="button" key={x} className={mode === x ? "active" : ""} onClick={() => setMode(x)}>
                            {modeLabels[x]}
                          </button>
                        ))}
                      </div>
                      {mode !== "none" && mode !== "local" && (
                        <div className="modelPanel">
                          <div className="providerGrid">
                            <label>
                              Provider
                              <select value={provider} onChange={(e) => chooseProvider(e.target.value as LlmProviderId)}>
                                {providers.map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Model
                              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" />
                            </label>
                          </div>
                          <label>
                            Base URL
                            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="OpenAI-compatible endpoint" />
                          </label>
                          <div className="keyActions">
                            {p.keyUrl ? (
                              <a className="secondaryButton" href={p.keyUrl} target="_blank" rel="noreferrer">
                                Get key
                              </a>
                            ) : (
                              <span className="secondaryButton mutedButton">Custom endpoint</span>
                            )}
                            <button type="button" className="secondaryButton" onClick={() => setKeyOpen(!keyOpen)}>
                              {keyOpen ? "Hide key" : "Set key"}
                            </button>
                          </div>
                          {keyOpen && (
                            <input
                              className="passwordField"
                              type="password"
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              placeholder="Session API key"
                            />
                          )}
                        </div>
                      )}
                      </div>
                      <FilterPanelFooter applyLabel="Save engine choices" onApply={applyFilterPanel} onClose={closeFilterPanel} />
                    </div>
                  )}
                </div>
              </div>
            </section>
          </ManuscriptCard>
        </form>

        <section className="results resultStack" aria-live="polite">
          {!data ? (
            <LaunchPanel
              readiness={readiness}
              abstractWords={abstractWords}
              keywordCount={keywordList.length}
              policy={appliedPolicySummary}
              busy={busy}
            />
          ) : (
            <>
              <RunSnapshot data={data} batch={batch} consensusJournal={consensusJournal} counts={decisionCounts} />
              <Funnel data={data} />
              <ComparisonTray journals={selectedJournals} onRemove={toggleSelected} />
              <div className="decisionToolbar">
                <div className="batchNavGroup">
                  <span className="eyebrow">DECISION ROOM</span>
                  <div className="batchNav">
                    <button
                      type="button"
                      className="batchArrow"
                      onClick={goBack}
                      disabled={historyIndex <= 0}
                      aria-label="Previous batch"
                      title="Previous batch"
                    >
                      ←
                    </button>
                    <h2>
                      Batch {batch} of {history.length}
                      {historyIndex === history.length - 1 ? ": recommended now" : " (reviewed)"}
                    </h2>
                    <button
                      type="button"
                      className="batchArrow"
                      onClick={goForward}
                      disabled={historyIndex >= history.length - 1}
                      aria-label="Next batch"
                      title="Next batch already fetched"
                    >
                      →
                    </button>
                  </div>
                </div>
                <div className="tabs" role="tablist" aria-label="Result views">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === "recommendations"}
                    className={view === "recommendations" ? "active" : ""}
                    onClick={() => setView("recommendations")}
                  >
                    Cards
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === "explorer"}
                    className={view === "explorer" ? "active" : ""}
                    onClick={() => setView("explorer")}
                  >
                    Explorer ({data.rankingExplorer.length})
                  </button>
                </div>
              </div>
              {view === "recommendations" ? (
                <>
                  {data.journals.map((journal, index) => (
                    <Journal
                      key={journal.id}
                      journal={journal}
                      rank={index + 1}
                      decision={decisions[journal.id] || emptyDecision()}
                      selected={selectedIds.includes(journal.id)}
                      onToggleSelected={() => toggleSelected(journal.id)}
                      onDecision={(patch) =>
                        setDecisions((state) => ({
                          ...state,
                          [journal.id]: { ...(state[journal.id] || emptyDecision()), ...patch },
                        }))
                      }
                    />
                  ))}
                </>
              ) : (
                <Explorer rows={table} sort={sort} setSort={setSort} />
              )}
              <div className="card decisionFooter">
                <div>
                  <span className="eyebrow">NEXT ACTION</span>
                  <h3>{consensusJournal ? `Consensus emerging: ${consensusJournal.name}` : "No consensus yet"}</h3>
                  <p>
                    {data.decisionRun.hasMore
                      ? `${data.decisionRun.eligiblePoolSize.toLocaleString()} eligible journals remain in this evidence pool.`
                      : "Kagua has exhausted the current eligible evidence pool."}
                  </p>
                </div>
                <button type="button" className="nextBatch" disabled={busy || !data.decisionRun.hasMore} onClick={next}>
                  {busy ? "Loading next batch..." : "Show next 5"}
                </button>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="heroMetric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="smallMetric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function MetricRow({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`metricRow ${checked ? "on" : ""}`}>
      <button type="button" className="metricRowHead" aria-expanded={checked} onClick={() => onChange(!checked)}>
        <b>{label}</b>
        <i>{checked ? "ON" : "OFF"}</i>
      </button>
      {checked && <div className="metricRowBody">{children}</div>}
    </div>
  );
}

function FilterPanelFooter({
  applyLabel,
  onApply,
  onClose,
}: {
  applyLabel: string;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <div className="filterPanelFooter">
      <button type="button" className="secondaryButton" onClick={onClose}>
        Close
      </button>
      <button type="button" className="primary compactPrimary" onClick={onApply}>
        {applyLabel}
      </button>
    </div>
  );
}

function ManuscriptCard({
  inputMode,
  setInputMode,
  title,
  setTitle,
  abstract,
  setAbstract,
  manuscript,
  setManuscript,
  uploadState,
  onUpload,
  keywords,
  setKeywords,
  abstractWords,
  manuscriptWords,
  keywordCount,
  onDemo,
  onFilters,
  canSubmit,
  busy,
  readiness,
  publisherSummary,
  policy,
  error,
  children,
}: {
  inputMode: InputMode;
  setInputMode: (v: InputMode) => void;
  title: string;
  setTitle: (v: string) => void;
  abstract: string;
  setAbstract: (v: string) => void;
  manuscript: string;
  setManuscript: (v: string) => void;
  uploadState: ManuscriptUploadState;
  onUpload: (file: File | null) => void;
  keywords: string;
  setKeywords: (v: string) => void;
  abstractWords: number;
  manuscriptWords: number;
  keywordCount: number;
  onDemo: () => void;
  onFilters: () => void;
  canSubmit: boolean;
  busy: boolean;
  readiness: number;
  publisherSummary: string;
  policy: string;
  error: string;
  children?: React.ReactNode;
}) {
  const activeWords = inputMode === "structured" ? abstractWords : manuscriptWords;
  const inputModes: Array<{ value: InputMode; label: string; hint: string; icon: string }> = [
    { value: "structured", label: "Title & abstract", hint: "Fast entry", icon: "T" },
    { value: "upload", label: "Upload file", hint: "Best for manuscripts", icon: "U" },
    { value: "paste", label: "Paste text", hint: "Clean text only", icon: "P" },
  ];
  return (
    <section className="card manuscriptCard">
      <div className="searchCardHeader">
        <div>
          <span className="eyebrow">01 · MANUSCRIPT SIGNAL</span>
          <h2>What are you submitting?</h2>
        </div>
        <div className="searchCardActions">
          <button type="button" className="secondaryButton sampleButton" onClick={onDemo}>
            Try sample
          </button>
          <button type="button" className="secondaryButton sampleButton" onClick={onFilters}>
            Filters
          </button>
          <div className="scanControl" aria-live="polite">
            <div>
              <b>{busy ? "Scanning evidence..." : canSubmit ? "Ready to hunt" : "Add manuscript signal"}</b>
              <small>
                {readiness}% ready · {publisherSummary} · {policy}
              </small>
            </div>
            <button type="submit" className="primary scanButton" disabled={!canSubmit}>
              {busy ? "Scanning..." : "Start scan"}
            </button>
          </div>
        </div>
      </div>
      {error && <p className="error scanError">{error}</p>}
      {children}
      <div className="manuscriptModeToggle" aria-label="Manuscript input mode">
        {inputModes.map((option) => (
          <button
            type="button"
            key={option.value}
            className={inputMode === option.value ? "active" : ""}
            onClick={() => setInputMode(option.value)}
          >
            <span className="modeIcon">{option.icon}</span>
            <span className="modeText">
              <b>{option.label}</b>
              <small>{option.hint}</small>
            </span>
            <span className="modeCheck" aria-hidden="true" />
          </button>
        ))}
      </div>
      {inputMode === "structured" ? (
        <>
          <p className="mutedCopy manuscriptHint">A title alone or an abstract alone is enough to search. More of either sharpens the match.</p>
          <label>
            Manuscript title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Paste the working title" />
          </label>
          <label>
            Abstract
            <textarea
              rows={5}
              value={abstract}
              onChange={(e) => setAbstract(e.target.value)}
              placeholder="Paste the abstract or a structured summary"
            />
          </label>
        </>
      ) : inputMode === "upload" ? (
        <>
          <p className="mutedCopy manuscriptHint">
            Upload the manuscript and review the extracted text before Kagua searches for journals.
          </p>
          <label
            className={`manuscriptDrop ${uploadState.status === "reading" ? "isReading" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onUpload(e.dataTransfer.files?.[0] || null);
            }}
          >
            <input
              type="file"
              accept={manuscriptAccept}
              disabled={uploadState.status === "reading"}
              onChange={(e) => {
                onUpload(e.target.files?.[0] || null);
                e.currentTarget.value = "";
              }}
            />
            <span>+</span>
            <b>{uploadState.status === "reading" ? "Extracting manuscript..." : "Upload manuscript"}</b>
            <small>PDF, DOCX, TXT, PNG, JPG or TIFF</small>
          </label>
          {uploadState.status !== "idle" && (
            <div className={`ocrStatus ${uploadState.status}`}>
              <div>
                <b>{uploadState.fileName || "Manuscript"}</b>
                <span>{uploadState.message || "Waiting for extraction"}</span>
              </div>
              <small>
                {formatBytes(uploadState.fileSize)}
                {uploadState.provider ? ` · ${uploadState.provider}` : ""}
                {uploadState.confidence != null ? ` · ${Math.round(uploadState.confidence * 100)}%` : ""}
              </small>
            </div>
          )}
          {uploadState.warnings.length > 0 && (
            <ul className="ocrWarnings">
              {uploadState.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <label className="extractedPreview">
            Extracted manuscript preview
            <textarea
              rows={9}
              value={manuscript}
              onChange={(e) => setManuscript(e.target.value)}
              placeholder="Extracted manuscript text will appear here"
            />
          </label>
        </>
      ) : (
        <>
          <p className="mutedCopy manuscriptHint">
            Paste text only when you already have a clean manuscript export or the OCR service is unavailable.
          </p>
          <label>
            Manuscript text
            <textarea
              rows={14}
              value={manuscript}
              onChange={(e) => setManuscript(e.target.value)}
              placeholder="Paste clean manuscript text"
            />
          </label>
        </>
      )}
      <label>
        Keywords
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="ammonia decomposition, ceria, DFT"
        />
      </label>
      <div className="signalStrip">
        <SmallMetric label="Words" value={activeWords.toLocaleString()} />
        <SmallMetric label="Keywords" value={keywordCount.toString()} />
        <SmallMetric label="Source" value={inputMode === "structured" ? "Abstract" : inputMode === "upload" ? "Upload" : "Paste"} />
      </div>
    </section>
  );
}

function LaunchPanel({
  readiness,
  abstractWords,
  keywordCount,
  policy,
  busy,
}: {
  readiness: number;
  abstractWords: number;
  keywordCount: number;
  policy: string;
  busy: boolean;
}) {
  return (
    <div className={`card launchPanel ${busy ? "isBusy" : ""}`}>
      <div className="launchCopy">
        <span className="eyebrow">READY WHEN YOUR MANUSCRIPT IS</span>
        <h2>Evidence, eligibility and judgement in one workspace.</h2>
        <p>
          The recommendation room will show the shortlist, decision notes, score balance, eligibility explanation and
          source ledger after analysis.
        </p>
      </div>
      <div className="readinessPanel">
        <div className="readinessDial" style={{ ["--ready" as string]: `${readiness}%` }}>
          <b>{readiness}%</b>
          <span>Ready</span>
        </div>
        <div className="readinessGrid">
          <SmallMetric label="Abstract" value={`${abstractWords} words`} />
          <SmallMetric label="Keywords" value={String(keywordCount)} />
          <SmallMetric label="Authority" value={policy} />
        </div>
      </div>
      <div className="routeLine" aria-hidden="true">
        <span>Manuscript</span>
        <span>Evidence</span>
        <span>Eligibility</span>
        <span>Top 5</span>
      </div>
    </div>
  );
}

function RunSnapshot({
  data,
  batch,
  consensusJournal,
  counts,
}: {
  data: AnalysisResponse;
  batch: number;
  consensusJournal?: JournalScore;
  counts: { signals: number; rejected: number; open: number };
}) {
  return (
    <section className="card runSnapshot">
      <div className="snapshotLead">
        <span className="eyebrow">RUN SNAPSHOT</span>
        <h2>{data.fingerprint.field}</h2>
        <p>{data.editorialBoard.verdict}</p>
      </div>
      <div className="snapshotGrid">
        <SmallMetric label="Batch" value={String(batch)} />
        <SmallMetric label="Eligible pool" value={data.decisionRun.eligiblePoolSize.toLocaleString()} />
        <SmallMetric label="Policy" value={policyLabels[data.eligibilityRun.policy]} />
        <SmallMetric label="Open decisions" value={String(counts.open)} />
      </div>
      <div className="boardColumns">
        <BoardList title="Strengths" items={data.editorialBoard.strengths} />
        <BoardList title="Concerns" items={data.editorialBoard.concerns} />
        <BoardList title="Actions" items={data.editorialBoard.actions} />
      </div>
      <div className={consensusJournal ? "consensusBanner active" : "consensusBanner"}>
        <b>{consensusJournal ? "Consensus signal" : "Consensus monitor"}</b>
        <span>
          {consensusJournal
            ? `${consensusJournal.name} has approval from both reviewer roles.`
            : `${counts.signals} positive signal(s), ${counts.rejected} fully rejected journal(s).`}
        </span>
      </div>
      <div className="runMeta">
        <span>{data.evidenceRun.candidateSources.join(" + ") || "Evidence sources pending"}</span>
        <span>{data.evidenceRun.dhetEdition}</span>
        <span>{data.llmRun?.selectedModel || modeLabels[data.llmModeUsed]}</span>
      </div>
    </section>
  );
}

function BoardList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="boardList">
      <b>{title}</b>
      {items.slice(0, 3).map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function Funnel({ data }: { data: AnalysisResponse }) {
  const f = data.funnel;
  const steps = [
    [f.relevantPublications, "Relevant publications"],
    [f.candidateJournals, "Candidate journals"],
    [f.eligibilityPassed, "Eligibility passed"],
    [f.scopePassed, "Scope passed"],
    [f.constraintsPassed, "Meet limits"],
    [f.ranked, "Ranked"],
    [f.recommended, "Top 5"],
  ] as const;

  return (
    <div className="card funnel">
      <div className="cardHead">
        <div>
          <span className="step">AUDIT</span>
          <h2>Evidence funnel</h2>
        </div>
        <span className="statusPill">{data.evidenceRun.liveEvidence ? "Live evidence" : "Cached evidence"}</span>
      </div>
      <div className="funnelSteps">
        {steps.map(([n, label]) => (
          <div key={label}>
            <b>{n.toLocaleString()}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p>{data.evidenceNote}</p>
    </div>
  );
}

function ComparisonTray({ journals, onRemove }: { journals: JournalScore[]; onRemove: (id: string) => void }) {
  return (
    <section className="card comparisonTray">
      <div className="cardHead">
        <div>
          <span className="step">COMPARE</span>
          <h2>Shortlist lens</h2>
        </div>
        <span className="statusPill">{journals.length}/4 selected</span>
      </div>
      {journals.length ? (
        <div className="compareGrid">
          {journals.map((journal) => (
            <div className="compareItem" key={journal.id}>
              <button type="button" className="removeCompare" onClick={() => onRemove(journal.id)} aria-label={`Remove ${journal.name}`}>
                x
              </button>
              <b>{journal.name}</b>
              <div className="compareScores">
                <SmallMetric label="KPOS" value={String(journal.kpos)} />
                <SmallMetric label="Fit" value={String(journal.fit)} />
                <SmallMetric label="Qx" value={journal.quartile} />
              </div>
              <span>{journal.eligibility?.explanation || journal.dhet}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mutedCopy">Select journals from the batch to compare fit, pathway score and eligibility side by side.</p>
      )}
    </section>
  );
}

function Explorer({ rows, sort, setSort }: { rows: JournalScore[]; sort: SortKey; setSort: (x: SortKey) => void }) {
  return (
    <div className="card explorer">
      <div className="rankHeader">
        <div>
          <span className="eyebrow">RANKING EXPLORER</span>
          <h2>Top {rows.length} candidates</h2>
        </div>
        <label>
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="kpos">KPOS</option>
            <option value="trilemma">KTS</option>
            <option value="fit">Scope fit</option>
            <option value="quality">Quality</option>
            <option value="affordability">Affordability</option>
            <option value="speed">Speed</option>
            <option value="impactFactor">JIF</option>
          </select>
        </label>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Journal</th>
              <th>Status</th>
              <th>Fit</th>
              <th>Qx</th>
              <th>JIF</th>
              <th>APC</th>
              <th>KTS</th>
              <th>KPOS</th>
              <th>DHET</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((journal) => (
              <tr key={journal.id}>
                <td>{journal.rank}</td>
                <td>
                  <b>{journal.name}</b>
                  <small className="rowMeta">{journal.publisher}</small>
                </td>
                <td>{journal.batchLabel}</td>
                <td>{journal.fit}</td>
                <td>{journal.quartile}</td>
                <td>{journal.impactFactor ?? "-"}</td>
                <td>{journal.apcDisplay || "-"}</td>
                <td>{journal.trilemma}</td>
                <td>
                  <b>{journal.kpos}</b>
                </td>
                <td>{journal.dhet === "Recognised" ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Journal({
  journal,
  rank,
  decision,
  selected,
  onToggleSelected,
  onDecision,
}: {
  journal: JournalScore;
  rank: number;
  decision: Decision;
  selected: boolean;
  onToggleSelected: () => void;
  onDecision: (x: Partial<Decision>) => void;
}) {
  const consensus = decision.researcher === "approve" && decision.supervisor === "approve";
  const rejected = decision.researcher === "reject" && decision.supervisor === "reject";

  return (
    <article className={`journal card ${selected ? "selectedJournal" : ""}`}>
      <div className="journalRankBadge">
        <span>#{rank}</span>
        <b>{journal.kpos}</b>
        <small>KPOS</small>
      </div>
      <div className="journalMain">
        <div className="journalTitle journalHeader">
          <div>
            <span className="eyebrow">{journal.label}</span>
            <h3>{journal.name}</h3>
            <p>{journal.publisher}</p>
          </div>
          <div className="journalActions">
            <button type="button" className={selected ? "secondaryButton activeCompare" : "secondaryButton"} onClick={onToggleSelected}>
              {selected ? "Comparing" : "Compare"}
            </button>
            <span className={consensus ? "label good" : rejected ? "label dangerLabel" : "label"}>{consensus ? "Consensus" : rejected ? "Rejected" : journal.dhet}</span>
          </div>
        </div>

        {journal.relevanceCheck?.checked && !journal.relevanceCheck.relevant && (
          <div className="relevanceFlag">
            <b>LLM field-relevance check: possible mismatch</b>
            <span>{journal.relevanceCheck.reason || "The reviewing model flagged this journal's field as a likely mismatch for this manuscript. The deterministic scope-fit score above still cleared its floor — use researcher judgment before shortlisting."}</span>
          </div>
        )}

        <div className="scoreRibbon">
          <Score name="KTS" value={journal.trilemma} />
          <Score name="Scope" value={journal.fit} />
          <Score name="Quality" value={journal.quality} />
          <Score name="Access" value={journal.affordability} />
          <Score name="Speed" value={journal.speed} />
        </div>

        <div className="factsGrid">
          <Fact label="Eligibility" value={journal.eligibility?.source || journal.dhet} />
          <Fact label="Matched by" value={journal.eligibility?.matchedBy || "ISSN"} />
          <Fact label="Shared terms" value={String(journal.sharedTerms)} hint="Substantive words this journal's evidence shares with your manuscript — the topical gate behind the Scope score." />
          <Fact
            label="Quartile"
            value={journal.quartile}
            hint={journal.quartile === "Unverified" ? "No licensed ranking source configured. Upload your library's JCR/Scopus export on this page to unlock a verified quartile." : undefined}
          />
          <Fact
            label="JIF"
            value={journal.impactFactor == null ? "Not verified" : String(journal.impactFactor)}
            hint={journal.impactFactor == null ? "Clarivate JIF has no free API, and publisher pages actively block automated requests for it (tested against ScienceDirect: blocked, not scraped — see the Manual for the actual response). Upload your institution's JCR export to verify it, or see the OpenAlex percentile below for a free proxy." : undefined}
          />
          <Fact label="OpenAlex percentile" value={journal.citationPercentile == null ? "No sample" : `${journal.citationPercentile}th`} hint="This journal's 2-year mean citedness ranked against the other candidates in this search — a free, real signal, not a substitute for JIF." />
          <Fact label="APC" value={journal.apcDisplay || "Unknown"} />
          <Fact label="Works" value={journal.matchedWorks.toLocaleString()} />
          <Fact label="Africa-authored" value={formatAfricaShare(journal.africaAuthorship)} />
        </div>

        <div className="trilemmaPanel">
          <TrilemmaTriangle nodes={journal.trilemmaNodes} grade={journal.trilemmaBalanceGrade} />
          <div className="trilemmaSide">
            <p className="why">{journal.rationale}</p>
            <div className="nodeGrid">
              {journal.trilemmaNodes.map((node) => (
                <NodeCard key={node.key} node={node} />
              ))}
            </div>
          </div>
        </div>
        {journal.risk && <p className="riskNote">{journal.risk}</p>}

        <SimilarWorkPanel works={journal.similarWorks} africa={journal.africaAuthorship} />

        <details className="detailPanel">
          <summary>Why this rank?</summary>
          <div className="detailGrid">
            {journal.trilemmaNodes.map((node) => (
              <NodeLedger key={node.key} node={node} />
            ))}
          </div>
        </details>

        <details className="detailPanel">
          <summary>Evidence ledger</summary>
          <EvidenceLedger items={journal.evidence} />
        </details>

        <div className="voteGrid">
          <VoteControl label="Researcher" value={decision.researcher} onChange={(researcher) => onDecision({ researcher })} />
          <VoteControl label="Supervisor" value={decision.supervisor} onChange={(supervisor) => onDecision({ supervisor })} />
        </div>
        <label className="noteBox">
          Decision note
          <textarea
            rows={2}
            value={decision.note}
            onChange={(e) => onDecision({ note: e.target.value })}
            placeholder="Record submission fit, supervisor caveat, APC concern or next check"
          />
        </label>
      </div>
    </article>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <span className={hint ? "factHinted" : undefined} title={hint}>
      {label}
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </span>
  );
}

function formatAfricaShare(signal?: AfricaAuthorshipSignal | null) {
  if (!signal) return "Not sampled";
  if (!signal.sampleSize) return "No sample";
  return `${signal.africaCount}/${signal.sampleSize} recent (${signal.sharePct}%)`;
}

function SimilarWorkPanel({ works, africa }: { works?: SimilarWork[]; africa?: AfricaAuthorshipSignal | null }) {
  if (!works || !works.length) {
    return (
      <div className="similarPanel similarPanelEmpty">
        <div className="cardHead">
          <span className="eyebrow">SIMILAR RECENT WORK IN THIS JOURNAL</span>
        </div>
        <p className="mutedCopy">
          No similar recent articles could be resolved for this journal in the live OpenAlex search just now — the
          journal&apos;s OpenAlex source may be unindexed, or the live lookup timed out. This is a gap in this specific
          enrichment step, not evidence the journal lacks relevant work.
        </p>
      </div>
    );
  }
  return (
    <div className="similarPanel">
      <div className="cardHead">
        <span className="eyebrow">SIMILAR RECENT WORK IN THIS JOURNAL</span>
        {africa && (
          <span className="statusPill">
            {africa.africaCount}/{africa.sampleSize} sampled articles Africa-authored
          </span>
        )}
      </div>
      <ol className="similarList">
        {works.map((w, i) => (
          <li key={`${w.title}-${i}`}>
            <i>{i + 1}</i>
            {w.url ? (
              <a href={w.url} target="_blank" rel="noreferrer" title={w.title}>
                {w.title}
              </a>
            ) : (
              <span title={w.title}>{w.title}</span>
            )}
            {w.hasAfricaAuthor && <b title="Africa-affiliated author">AF</b>}
            <small>{w.year || "—"}</small>
          </li>
        ))}
      </ol>
      <p className="mutedCopy similarNote">
        From a live search of this journal&apos;s own back catalogue for work matching your manuscript — a sample, not a full census.
      </p>
    </div>
  );
}

function Score({ name, value }: { name: string; value: number }) {
  return (
    <div className="score">
      <span>{name}</span>
      <b>{value}</b>
      <i>
        <em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </i>
    </div>
  );
}

function NodeCard({ node }: { node: TrilemmaNode }) {
  return (
    <div className="nodeCard">
      <span>{node.label}</span>
      <b>
        {node.score} <small>{node.grade}</small>
      </b>
      <i>
        <em style={{ width: `${Math.max(0, Math.min(100, node.score))}%` }} />
      </i>
    </div>
  );
}

// Balance triangle, in the spirit of the World Energy Council's Trilemma
// Index: each dimension is an axis of an equilateral triangle: the closer
// the plotted point sits to a vertex, the stronger that dimension; a
// perfectly balanced journal draws a triangle centred in the frame, while
// an imbalanced one (e.g. strong on one axis, weak on the others) draws a
// lopsided shape pulled toward a single corner — the shape itself is the
// story, before you read a single number.
const TRI_ANGLES = [-90, 30, 150].map((d) => (d * Math.PI) / 180);
const TRI_GRADE_COLOR: Record<string, string> = {
  A: "var(--good)",
  B: "var(--accent)",
  C: "var(--warn)",
  D: "var(--danger)",
};
function triPoint(cx: number, cy: number, r: number, frac: number, axisIndex: number) {
  const a = TRI_ANGLES[axisIndex];
  return [cx + Math.cos(a) * r * frac, cy + Math.sin(a) * r * frac] as const;
}
function triPolygon(cx: number, cy: number, r: number, fracs: number[]) {
  return fracs.map((f, i) => triPoint(cx, cy, r, f, i).join(",")).join(" ");
}

function TrilemmaTriangle({ nodes, grade }: { nodes: TrilemmaNode[]; grade: string }) {
  const cx = 108;
  const cy = 100;
  const r = 72;
  const rings = [0.25, 0.5, 0.75, 1];
  const fracs = nodes.map((n) => Math.max(0.05, n.score / 100));
  const labelAnchor: Array<"middle" | "start" | "end"> = ["middle", "start", "end"];
  const labelDx = [0, 8, -8];
  const labelDy = [-10, 4, 4];
  return (
    <div className="triWrap">
      <svg viewBox="0 0 216 200" className="triSvg" role="img" aria-label={`Balance triangle: ${nodes.map((n) => `${n.label} ${n.score}, grade ${n.grade}`).join("; ")}`}>
        {rings.map((f) => (
          <polygon key={f} points={triPolygon(cx, cy, r, [f, f, f])} className="triRing" />
        ))}
        {TRI_ANGLES.map((a, i) => (
          <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * r} y2={cy + Math.sin(a) * r} className="triAxis" />
        ))}
        <polygon points={triPolygon(cx, cy, r, fracs)} className="triShape" />
        {nodes.map((n, i) => {
          const [x, y] = triPoint(cx, cy, r, fracs[i], i);
          return <circle key={n.key} cx={x} cy={y} r={4.5} fill={TRI_GRADE_COLOR[n.grade] || "var(--accent)"} className="triDot" />;
        })}
        {nodes.map((n, i) => {
          const [x, y] = triPoint(cx, cy, r + 26, 1, i);
          return (
            <text key={n.key} x={x + labelDx[i]} y={y + labelDy[i]} textAnchor={labelAnchor[i]} className="triLabel">
              <tspan x={x + labelDx[i]} dy="0" className="triLabelName">
                {n.label}
              </tspan>
              <tspan x={x + labelDx[i]} dy="13" className="triLabelScore">
                {n.score} · {n.grade}
              </tspan>
            </text>
          );
        })}
        <text x={cx} y={cy + 4} textAnchor="middle" className="triCenterGrade">
          {grade}
        </text>
      </svg>
    </div>
  );
}

function NodeLedger({ node }: { node: TrilemmaNode }) {
  return (
    <div className="nodeLedger">
      <h4>
        {node.label} <span>{node.grade}</span>
      </h4>
      {node.contributions.map((item) => (
        <Contribution key={`${node.key}-${item.key}-${item.label}`} item={item} />
      ))}
    </div>
  );
}

function Contribution({ item }: { item: ScoreContribution }) {
  return (
    <div className="contributionRow">
      <div>
        <b>{item.label}</b>
        <span>{item.raw}</span>
      </div>
      <small>{item.status}</small>
      <em>{item.weightedPoints.toFixed(1)}</em>
    </div>
  );
}

function EvidenceLedger({ items }: { items: EvidenceItem[] }) {
  if (!items.length) return <p className="mutedCopy">No evidence records were attached to this journal.</p>;
  return (
    <div className="evidenceRows">
      {items.map((item, index) => (
        <div className="evidenceRow" key={`${item.source}-${item.field}-${index}`}>
          <div>
            <b>
              {item.source} / {item.field.replaceAll("_", " ")}
            </b>
            <span>{String(item.value ?? "Unknown")}</span>
            {item.note && <small>{item.note}</small>}
          </div>
          <i>{formatConfidence(item.confidence)}</i>
        </div>
      ))}
    </div>
  );
}

function VoteControl({ label, value, onChange }: { label: string; value: Vote; onChange: (v: Vote) => void }) {
  return (
    <div className="voteControl">
      <span>{label}</span>
      <div>
        <button
          type="button"
          className={`approve ${value === "approve" ? "active" : ""}`}
          onClick={() => onChange(value === "approve" ? "undecided" : "approve")}
        >
          Suitable
        </button>
        <button
          type="button"
          className={`reject ${value === "reject" ? "active" : ""}`}
          onClick={() => onChange(value === "reject" ? "undecided" : "reject")}
        >
          Not suitable
        </button>
      </div>
    </div>
  );
}

function formatConfidence(value: number) {
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value);
  return `${pct}% confidence`;
}
