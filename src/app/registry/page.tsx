"use client";

import { useEffect, useMemo, useState } from "react";
import { parseCustomJournalList } from "@/lib/kagua/custom-list";

type Row = {
  title: string;
  publisher?: string | null;
  issns: string[];
  indices: string[];
  quartile?: string | null;
  impactFactor?: number | null;
  impactFactorYear?: number | null;
  source: string;
  edition: string;
  sourceUrl: string;
  retrievedAt: string;
  matchedBy: string;
};
type Enrichment = {
  title: string;
  publisher?: string | null;
  issns: string[];
  journalUrl?: string | null;
  scope?: string | null;
  scopeSource?: string | null;
  description?: string | null;
  openAlex?: {
    id: string;
    hIndex?: number | null;
    twoYearMeanCitedness?: number | null;
    citedByCount?: number | null;
    worksCount?: number | null;
  } | null;
  attempts: { agent: string; status: string; detail?: string }[];
  generatedAt: string;
};
type PublisherOption = { value: string; label: string; count: number };
type ImportedList = { name: string; entries: { title?: string; issns: string[] }[] };

async function readJson<T>(response: Response, fallback: string): Promise<T & { error?: string }> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return { error: response.ok ? "" : fallback } as T & { error?: string };
  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    return { error: fallback } as T & { error?: string };
  }
}

export default function Registry() {
  const [q, setQ] = useState("");
  const [quartiles, setQuartiles] = useState("");
  const [publisher, setPublisher] = useState("");
  const [publishers, setPublishers] = useState<PublisherOption[]>([]);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [verified, setVerified] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [registryError, setRegistryError] = useState("");
  const [registryNotice, setRegistryNotice] = useState("");
  const [imported, setImported] = useState<ImportedList | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [enrich, setEnrich] = useState<Enrichment | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [swarm, setSwarm] = useState(false);
  const [swarmDone, setSwarmDone] = useState(0);

  const importedRows = useMemo(() => imported?.entries || [], [imported]);

  async function load(overrides: { verified?: boolean } = {}) {
    setBusy(true);
    setRegistryError("");
    setRegistryNotice("");
    const params = new URLSearchParams({ limit: "250" });
    if (q) params.set("q", q);
    if (quartiles) params.set("quartiles", quartiles);
    if (publisher) params.set("publisher", publisher);
    if (min) params.set("jifMin", min);
    if (max) params.set("jifMax", max);
    if (overrides.verified ?? verified) params.set("verifiedJif", "true");

    try {
      const response = await fetch(`/api/registry?${params}`);
      const data = await readJson<{ rows?: Row[]; total?: number; publishers?: PublisherOption[] }>(
        response,
        `DHET registry failed to load (${response.status}).`,
      );
      if (!response.ok) throw new Error(data.error || "DHET registry failed to load.");
      const nextRows = data.rows || [];
      setRows(nextRows);
      setTotal(data.total || 0);
      if (data.publishers) setPublishers(data.publishers);
      return nextRows;
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : "DHET registry failed to load.");
      setRows([]);
      setTotal(0);
      return [] as Row[];
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    async function loadInitial() {
      setBusy(true);
      try {
        const response = await fetch("/api/registry?limit=250");
        const data = await readJson<{ rows?: Row[]; total?: number; publishers?: PublisherOption[] }>(
          response,
          `DHET registry failed to load (${response.status}).`,
        );
        if (!alive) return;
        if (!response.ok) throw new Error(data.error || "DHET registry failed to load.");
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setPublishers(data.publishers || []);
      } catch (error) {
        if (alive) setRegistryError(error instanceof Error ? error.message : "DHET registry failed to load.");
      } finally {
        if (alive) setBusy(false);
      }
    }
    void loadInitial();
    return () => {
      alive = false;
    };
  }, []);

  async function importList(file: File | null) {
    if (!file) return;
    setImportBusy(true);
    setRegistryError("");
    try {
      const parsed = await parseCustomJournalList(file);
      setImported(parsed);
      setRegistryNotice(`${parsed.entries.length.toLocaleString()} institutional journal records imported.`);
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : "Could not read the institutional list.");
    } finally {
      setImportBusy(false);
    }
  }

  async function inspect(row: Row) {
    setSelected(row);
    setEnrich(null);
    setEnrichBusy(true);
    setRegistryError("");
    try {
      const response = await fetch("/api/registry/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: row.title, issns: row.issns }),
      });
      const data = await readJson<Enrichment>(response, `Journal enrichment failed (${response.status}).`);
      if (!response.ok) throw new Error(data.error || "Journal enrichment failed.");
      setEnrich(data);
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : "Journal enrichment failed.");
    } finally {
      setEnrichBusy(false);
    }
  }

  async function runSwarm() {
    if (swarm) return;
    setRegistryError("");
    setRegistryNotice("");
    const currentRows = rows.length ? rows : await load();
    const batch = currentRows.slice(0, Math.min(currentRows.length, 20));
    if (!batch.length) {
      setRegistryError("No visible DHET records are loaded. Search or clear filters, then run the evidence swarm.");
      return;
    }

    setSwarm(true);
    setSwarmDone(0);
    await Promise.allSettled(batch.map(async (row) => {
      try {
        await fetch("/api/registry/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: row.title, issns: row.issns }),
        });
      } catch {}
      setSwarmDone((n) => n + 1);
    }));
    setSwarm(false);
    setRegistryNotice(`Evidence swarm checked ${batch.length} visible records.`);
  }

  async function setVerifiedFilter(next: boolean) {
    setVerified(next);
    await load({ verified: next });
  }

  return (
    <main className="shell registryShell">
      <section className="registryMast">
        <div>
          <span className="eyebrow">DHET + INSTITUTIONAL EVIDENCE GRAPH</span>
          <h1>
            Journal Intelligence <em>Database</em>
          </h1>
          <p>Search recognised journals, inspect provenance, resolve official journal links, and retrieve publisher scope evidence.</p>
        </div>
        <div className="registryStats">
          <Stat n={total.toLocaleString()} l="matching journals" />
          <Stat n={rows.length.toLocaleString()} l="loaded" />
          <Stat n={imported ? imported.entries.length.toLocaleString() : "0"} l="institutional" />
        </div>
      </section>

      <section className="registryToolbar card" aria-label="DHET registry search filters">
        <div className="registrySearch">
          <span>⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
            placeholder="Search journal, ISSN, publisher or index..."
          />
        </div>
        <select value={publisher} onChange={(e) => setPublisher(e.target.value)} aria-label="Filter by publisher">
          <option value="">All publishers</option>
          {publishers.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.count.toLocaleString()})
            </option>
          ))}
        </select>
        <select value={quartiles} onChange={(e) => setQuartiles(e.target.value)} aria-label="Filter by quartile">
          <option value="">All quartiles</option>
          <option value="Q1">Q1</option>
          <option value="Q2">Q2</option>
          <option value="Q3">Q3</option>
          <option value="Q4">Q4</option>
          <option value="Q1,Q2">Q1-Q2</option>
          <option value="Q2,Q3">Q2-Q3</option>
          <option value="Q3,Q4">Q3-Q4</option>
          <option value="Q1,Q2,Q3">Q1-Q3</option>
          <option value="Q2,Q3,Q4">Q2-Q4</option>
        </select>
        <input aria-label="Minimum JIF" type="number" step="0.1" value={min} onChange={(e) => setMin(e.target.value)} placeholder="JIF min" />
        <input aria-label="Maximum JIF" type="number" step="0.1" value={max} onChange={(e) => setMax(e.target.value)} placeholder="JIF max" />
        <button type="button" className="primary" onClick={() => void load()} disabled={busy}>
          {busy ? "Searching..." : "Search"}
        </button>
      </section>

      {(registryError || registryNotice) && (
        <p className={registryError ? "error registryFeedback" : "registryFeedback successFeedback"}>{registryError || registryNotice}</p>
      )}

      <section className="registryActions">
        <label className="importCard card">
          <span className="dbIcon">⇧</span>
          <div>
            <b>Import institutional list</b>
            <small>Excel, CSV or TSV. Your list becomes an eligibility layer alongside DHET.</small>
          </div>
          <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" onChange={(e) => importList(e.target.files?.[0] || null)} />
          <span className="secondaryButton">{importBusy ? "Reading..." : imported ? "Replace list" : "Choose file"}</span>
        </label>
        <button type="button" className="swarmCard card" onClick={() => void runSwarm()} disabled={swarm || busy}>
          <span className="dbIcon">◎</span>
          <span>
            <b>{swarm ? `Evidence swarm ${swarmDone}/20` : "Run evidence swarm"}</b>
            <small>Resolve journal sites and publisher evidence for the first 20 visible records.</small>
          </span>
        </button>
        <label className="verifiedToggle toggleCard card">
          <input type="checkbox" role="switch" checked={verified} onChange={(e) => void setVerifiedFilter(e.target.checked)} />
          <span>
            <b>Verified JIF only</b>
            <small>Reloads immediately and hides records without explicit source evidence.</small>
          </span>
        </label>
      </section>

      {imported && (
        <section className="importStatus card">
          <div>
            <span className="liveDot" /> <b>{imported.name}</b> · {importedRows.length} journals imported
          </div>
          <button type="button" className="textButton" onClick={() => setImported(null)}>
            Remove institutional layer
          </button>
        </section>
      )}

      <section className="registryGrid">
        <div className="registryTable card">
          <div className="dbHead">
            <div>
              <b>Journal records</b>
              <small>{total.toLocaleString()} match current filters · select a row to inspect live evidence</small>
            </div>
            <span className="liveBadge">
              <i /> LIVE SOURCES
            </span>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Journal</th>
                  <th>ISSN / eISSN</th>
                  <th>Index</th>
                  <th>Qx</th>
                  <th>JIF</th>
                  <th>Publisher</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.title}-${index}`} className={selected === row ? "selectedRow" : ""} onClick={() => void inspect(row)}>
                    <td>
                      <b>{row.title}</b>
                      <small className="rowMeta">{row.impactFactorYear ? `JIF ${row.impactFactorYear}` : "DHET record"}</small>
                    </td>
                    <td>{row.issns.join(", ") || "-"}</td>
                    <td>{row.indices.join(", ") || "-"}</td>
                    <td>
                      <span className={row.quartile ? "qxBadge" : "unknownBadge"}>{row.quartile || "?"}</span>
                    </td>
                    <td>{row.impactFactor ?? "-"}</td>
                    <td>{row.publisher || "-"}</td>
                    <td>
                      <button className="inspectButton" type="button">
                        Inspect →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="evidenceDrawer card">
          {!selected ? (
            <div className="drawerEmpty">
              <span>◎</span>
              <h3>Evidence inspector</h3>
              <p>Select a journal record. Kagua will dispatch resolver agents to find scholarly metadata, the journal homepage and publisher scope evidence.</p>
            </div>
          ) : (
            <>
              <div className="drawerHead">
                <span className="eyebrow">LIVE JOURNAL RECORD</span>
                <h2>{selected.title}</h2>
                <p>{selected.issns.join(" · ")}</p>
              </div>
              {enrichBusy ? (
                <div className="agentRunning">
                  <i /> Agents resolving journal evidence...
                </div>
              ) : enrich ? (
                <>
                  <div className="agentGrid">
                    {enrich.attempts.map((attempt, index) => (
                      <div key={`${attempt.agent}-${index}`} className={attempt.status === "success" ? "agentOk" : "agentMuted"}>
                        <i />
                        <span>
                          <b>{attempt.agent}</b>
                          <small>{attempt.status}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                  {enrich.journalUrl && (
                    <a className="journalLink" href={enrich.journalUrl} target="_blank" rel="noreferrer">
                      Open journal website ↗
                    </a>
                  )}
                  <div className="scopePanel">
                    <span className="eyebrow">PUBLISHER SCOPE EVIDENCE</span>
                    <p>{enrich.scope || "Publisher scope page was not reachable in this run. Kagua keeps this field unverified rather than inventing it."}</p>
                  </div>
                  {enrich.openAlex && (
                    <div className="metricStrip">
                      <Stat n={String(enrich.openAlex.hIndex ?? "-")} l="OpenAlex h-index" />
                      <Stat n={String(enrich.openAlex.worksCount ?? "-")} l="works" />
                      <Stat n={String(enrich.openAlex.citedByCount ?? "-")} l="citations" />
                    </div>
                  )}
                </>
              ) : (
                <p>No live enrichment returned.</p>
              )}
            </>
          )}
        </aside>
      </section>
    </main>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="dbStat">
      <b>{n}</b>
      <small>{l}</small>
    </div>
  );
}
