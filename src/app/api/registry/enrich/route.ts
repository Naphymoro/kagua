import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA = "Kagua/1.0 Journal Evidence Engine";
const clean = (v: unknown) => String(v ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const normIssn = (v: unknown) => {
  const s = String(v ?? "").toUpperCase().replace(/[^0-9X]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
};

async function fetchJson(url: string, timeout = 8000) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: c.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(id); }
}

async function fetchHtml(url: string, timeout = 6500) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: c.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const type = r.headers.get("content-type") || "";
    if (!type.includes("text/html")) throw new Error("not html");
    return { html: await r.text(), finalUrl: r.url };
  } finally { clearTimeout(id); }
}

function extractMeta(html: string) {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = clean(
    html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1]
  );
  const text = clean(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " "));
  const lower = text.toLowerCase();
  const anchors = ["aims and scope", "aim & scope", "aims & scope", "scope", "about the journal", "about this journal"];
  let scope = "";
  for (const a of anchors) {
    const i = lower.indexOf(a);
    if (i >= 0) { scope = text.slice(Math.max(0, i - 80), i + 1500); break; }
  }
  if (!scope) scope = description || text.slice(0, 900);
  return { title, description, scope: scope.slice(0, 1800) };
}

async function openAlex(title: string, issns: string[]) {
  for (const issn of issns) {
    try {
      const d: any = await fetchJson(`https://api.openalex.org/sources/issn:${encodeURIComponent(issn)}`);
      if (d?.display_name) return d;
    } catch {}
  }
  if (!title) return null;
  try {
    const p = new URLSearchParams({ search: title, "per-page": "5" });
    const d: any = await fetchJson(`https://api.openalex.org/sources?${p}`);
    return d?.results?.[0] || null;
  } catch { return null; }
}

async function crossref(title: string, issns: string[]) {
  for (const issn of issns) {
    try {
      const d: any = await fetchJson(`https://api.crossref.org/journals/${encodeURIComponent(issn)}`);
      if (d?.message) return d.message;
    } catch {}
  }
  if (!title) return null;
  try {
    const d: any = await fetchJson(`https://api.crossref.org/journals?query=${encodeURIComponent(title)}&rows=5`);
    return d?.message?.items?.[0] || null;
  } catch { return null; }
}

async function doaj(title: string, issns: string[]) {
  for (const issn of issns) {
    try {
      const d: any = await fetchJson(`https://doaj.org/api/search/journals/${encodeURIComponent(`issn:${issn}`)}?pageSize=1`);
      const b = d?.results?.[0]?.bibjson;
      if (b) return b;
    } catch {}
  }
  if (!title) return null;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { title?: string; issns?: string[] };
    const title = clean(body.title).slice(0, 500);
    const issns = [...new Set((body.issns || []).map(normIssn).filter(Boolean) as string[])].slice(0, 6);
    if (!title && !issns.length) return NextResponse.json({ error: "Journal title or ISSN required." }, { status: 400 });

    const [oa, cr, dj] = await Promise.all([openAlex(title, issns), crossref(title, issns), doaj(title, issns)]);
    const resolvedTitle = clean(oa?.display_name || cr?.title || dj?.title || title);
    const publisher = clean(oa?.host_organization_name || cr?.publisher || dj?.publisher?.name || "");
    const homepageCandidates = [oa?.homepage_url, dj?.url, ...(Array.isArray(cr?.URL) ? cr.URL : [cr?.URL])]
      .filter((x): x is string => typeof x === "string" && /^https?:\/\//i.test(x));

    let publisherPage: { url: string; title: string; description: string; scope: string } | null = null;
    const attempts: { agent: string; status: string; detail?: string }[] = [
      { agent: "OpenAlex resolver", status: oa ? "success" : "no match" },
      { agent: "Crossref resolver", status: cr ? "success" : "no match" },
      { agent: "DOAJ resolver", status: dj ? "success" : "no match" },
    ];
    for (const url of [...new Set(homepageCandidates)].slice(0, 4)) {
      try {
        const h = await fetchHtml(url);
        const meta = extractMeta(h.html);
        publisherPage = { url: h.finalUrl, ...meta };
        attempts.push({ agent: "Publisher scope crawler", status: "success", detail: h.finalUrl });
        break;
      } catch (e) {
        attempts.push({ agent: "Publisher scope crawler", status: "failed", detail: e instanceof Error ? e.message : "unreachable" });
      }
    }

    return NextResponse.json({
      title: resolvedTitle,
      publisher: publisher || null,
      issns: [...new Set([...(oa?.issn || []), ...(cr?.ISSN || []), ...issns].map(normIssn).filter(Boolean))],
      journalUrl: publisherPage?.url || homepageCandidates[0] || null,
      scope: publisherPage?.scope || null,
      scopeSource: publisherPage ? "Publisher" : null,
      description: publisherPage?.description || null,
      openAlex: oa ? { id: oa.id, hIndex: oa.summary_stats?.h_index ?? null, twoYearMeanCitedness: oa.summary_stats?.["2yr_mean_citedness"] ?? null, citedByCount: oa.cited_by_count ?? null, worksCount: oa.works_count ?? null } : null,
      crossref: cr ? { publisher: cr.publisher || null, counts: cr.counts || null } : null,
      doaj: dj ? { url: dj.url || null, apc: dj.apc || null, license: dj.license || null } : null,
      attempts,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Journal enrichment failed." }, { status: 502 });
  }
}
