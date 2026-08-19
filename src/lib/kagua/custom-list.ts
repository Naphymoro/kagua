import type { CustomJournalEntry, CustomJournalList } from "./types";

const ISSN_RE = /\b\d{4}-?\d{3}[\dXx]\b/g;
const norm = (v: unknown) => {
  const s = String(v ?? "").toUpperCase().replace(/[^0-9X]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : "";
};
const compact = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => {
  const m = compact(v).replace(",", ".").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const qx = (v: unknown): "Q1" | "Q2" | "Q3" | "Q4" | null => {
  const m = compact(v).toUpperCase().match(/\bQ([1-4])\b/);
  return m ? (`Q${m[1]}` as "Q1" | "Q2" | "Q3" | "Q4") : null;
};

// Looks for a header row naming Impact Factor / Quartile / Publisher
// columns — the shape of a real library export (e.g. a Clarivate Journal
// Citation Reports extract), not just a bare list of titles/ISSNs. When
// found, those columns become verified metrics (source: "UniversityList")
// instead of Kagua guessing at a proxy. Falls back to free-text
// title/ISSN scanning (the original behaviour) when no such header exists.
function headerMap(rows: unknown[][]) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map((v) => compact(v).toLowerCase());
    const joined = cells.join(" | ");
    if (/issn|journal|title/.test(joined)) {
      const find = (re: RegExp) => cells.findIndex((x) => re.test(x));
      return {
        row: i,
        title: find(/^(journal\s*)?(title|name)$|journal title/),
        publisher: find(/publisher/),
        jif: find(/impact\s*factor|journal\s*impact\s*factor|^jif$/),
        quartile: find(/quartile|^q[1-4]$/),
        jifYear: find(/impact.*year|jif.*year|year.*impact/),
      };
    }
  }
  return null;
}

function freeTextEntry(row: unknown[], sourceRow: number): CustomJournalEntry | null {
  const text = row.map((v) => String(v ?? "").trim()).filter(Boolean);
  const issns = [...new Set<string>(text.flatMap((v) => [...v.matchAll(ISSN_RE)].map((m) => norm(m[0]))).filter(Boolean))];
  let title = "";
  for (const cell of text) {
    const stripped = cell.replace(ISSN_RE, "").replace(/\s+/g, " ").trim();
    if (
      stripped.length > 3 &&
      !/^(issn|eissn|journal|journal title|title|publisher|index|source)$/i.test(stripped) &&
      !/^https?:/i.test(stripped) &&
      !/^[0-9.]+$/.test(stripped)
    ) {
      title = stripped;
      break;
    }
  }
  if (!issns.length && !title) return null;
  return { title: title || undefined, issns, sourceRow };
}

export async function parseCustomJournalList(file: File): Promise<CustomJournalList> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const entries: CustomJournalEntry[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false }) as unknown[][];
    const hm = headerMap(rows);

    for (let i = 0; i < rows.length; i++) {
      const row = Array.isArray(rows[i]) ? rows[i] : [];
      if (hm && i === hm.row) continue;

      let entry: CustomJournalEntry | null = null;
      if (hm) {
        const issns = [...new Set<string>(row.flatMap((v) => [...String(v ?? "").matchAll(ISSN_RE)].map((m) => norm(m[0]))).filter(Boolean))];
        const title = hm.title >= 0 ? compact(row[hm.title]) : "";
        if (issns.length || title) {
          entry = {
            title: title || undefined,
            issns,
            sourceRow: i + 1,
            publisher: hm.publisher >= 0 ? compact(row[hm.publisher]) || null : null,
            impactFactor: hm.jif >= 0 ? num(row[hm.jif]) : null,
            impactFactorYear: hm.jifYear >= 0 ? num(row[hm.jifYear]) : null,
            quartile: hm.quartile >= 0 ? qx(row[hm.quartile]) : null,
          };
        }
      } else {
        entry = freeTextEntry(row, i + 1);
      }

      if (entry) entries.push(entry);
      if (entries.length >= 10000) break;
    }
    if (entries.length >= 10000) break;
  }

  const dedupe = new Map<string, CustomJournalEntry>();
  for (const e of entries) {
    const key = e.issns[0] || e.title?.toLowerCase() || String(e.sourceRow);
    const existing = dedupe.get(key);
    // Prefer whichever row actually carries metrics, if both match the same key.
    if (!existing || (existing.impactFactor == null && existing.quartile == null && (e.impactFactor != null || e.quartile != null))) {
      dedupe.set(key, e);
    }
  }
  return { name: file.name, entries: [...dedupe.values()] };
}
