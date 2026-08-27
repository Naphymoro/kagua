import { NextRequest, NextResponse } from "next/server";
import { buildEvidenceJournals, DHET_EDITION, enrichSimilarWork } from "@/lib/kagua/evidence";
import { applyEligibility } from "@/lib/kagua/eligibility";
import { enrichWithLlm } from "@/lib/kagua/llm";
import { publisherGroup, publisherLabel } from "@/lib/kagua/publishers";
import { rankJournals } from "@/lib/kagua/scoring";
import type { AnalysisRequest, AnalysisResponse, EligibilityPolicy, JournalScore } from "@/lib/kagua/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function selectedPublisherFilters(b: AnalysisRequest) {
  const values = Array.isArray(b.publisherFilters) && b.publisherFilters.length ? b.publisherFilters : b.publisherFilter ? [b.publisherFilter] : [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function metricFilter(j: JournalScore, b: AnalysisRequest) {
  const locks = b.constraintLocks || { dhet: true, apc: true, quartile: true, impactFactor: true, speed: false };
  const qs = b.metricPreferences?.quartile !== false ? b.quartileSelection || [] : [];
  const useJif = b.metricPreferences?.impactFactor !== false;
  const min = useJif ? b.impactFactorMin : null;
  const max = useJif ? b.impactFactorMax : null;
  const publisherFilters = selectedPublisherFilters(b);

  if (locks.quartile && qs.length && (!qs.includes(j.quartile as never) || j.quartile === "Unverified")) return false;
  if (locks.impactFactor && (typeof min === "number" || typeof max === "number") && j.impactFactor == null) return false;
  if (locks.impactFactor && typeof min === "number" && Number.isFinite(min) && j.impactFactor! < min) return false;
  if (locks.impactFactor && typeof max === "number" && Number.isFinite(max) && j.impactFactor! > max) return false;
  if (locks.apc && b.metricPreferences?.apc !== false && typeof b.budgetUsd === "number" && j.apcUsd != null && j.apcUsd > b.budgetUsd) return false;
  if (locks.speed && typeof b.desiredDays === "number" && j.firstDecisionDays != null && j.firstDecisionDays > b.desiredDays) return false;
  if (publisherFilters.length && !publisherFilters.includes(publisherGroup(j.publisher || "") || "")) return false;

  return true;
}

function jifText(b: AnalysisRequest) {
  const min = b.metricPreferences?.impactFactor !== false ? b.impactFactorMin : null;
  const max = b.metricPreferences?.impactFactor !== false ? b.impactFactorMax : null;
  if (typeof min === "number" && typeof max === "number") return `JIF ${min}-${max}`;
  if (typeof min === "number") return `JIF >= ${min}`;
  if (typeof max === "number") return `JIF <= ${max}`;
  return "";
}

function publisherText(b: AnalysisRequest) {
  const filters = selectedPublisherFilters(b);
  if (!filters.length) return "";
  return `publishers ${filters.map((value) => publisherLabel(value)).join(", ")}`;
}

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json()) as AnalysisRequest;
    const keywords = (raw.keywords || []).map((keyword) => keyword.trim()).filter(Boolean);
    if (!raw.title?.trim() && !raw.abstract?.trim() && !raw.manuscript?.trim() && !keywords.length) {
      return NextResponse.json(
        { error: "A title, abstract, manuscript, or topic/journal search term is required - any one alone is enough to search on." },
        { status: 400 },
      );
    }

    // Normalized once, here, rather than guarding every downstream template
    // literal individually: title/abstract/manuscript are each independently
    // optional now, but every call site below assumes strings.
    const body: AnalysisRequest = { ...raw, title: raw.title || "", abstract: raw.abstract || "", manuscript: raw.manuscript || "", keywords };

    if (body.title.length > 1000 || body.abstract.length > 30000 || (body.manuscript?.length || 0) > 60000) {
      return NextResponse.json({ error: "Manuscript input is too long." }, { status: 400 });
    }

    for (const [name, value] of [
      ["Minimum", body.impactFactorMin],
      ["Maximum", body.impactFactorMax],
    ] as const) {
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        return NextResponse.json({ error: `${name} Impact Factor must be zero or greater.` }, { status: 400 });
      }
    }

    if (typeof body.impactFactorMin === "number" && typeof body.impactFactorMax === "number" && body.impactFactorMin > body.impactFactorMax) {
      return NextResponse.json({ error: "Minimum Impact Factor cannot be greater than maximum Impact Factor." }, { status: 400 });
    }

    const ev = await buildEvidenceJournals(body);
    const ranked = rankJournals(ev.journals, body);
    const eligible = applyEligibility(ranked, body);
    const filtered = eligible.filter((journal) => metricFilter(journal, body));
    const explorer = filtered.slice(0, Math.min(50, body.explorerSize || 50)).map((journal, index) => ({
      ...journal,
      rank: index + 1,
      batchLabel: (index < 5 ? "Recommended now" : index < 10 ? "Next batch" : "Ranked candidate") as JournalScore["batchLabel"],
    }));
    const top = explorer.slice(0, body.batchSize || 5);
    const policy: EligibilityPolicy = body.eligibilityPolicy || (body.dhetOnly === false ? "all" : "dhet");
    const filters = [
      body.quartileSelection?.length ? `quartiles ${body.quartileSelection.join(", ")}` : "",
      jifText(body),
      publisherText(body),
    ]
      .filter(Boolean)
      .join(" and ");
    const relevantPublications = ev.journals.reduce((sum, journal) => sum + journal.matchedWorks, 0);
    const funnel = {
      relevantPublications,
      candidateJournals: ev.journals.length,
      eligibilityPassed: eligible.length,
      scopePassed: ranked.length,
      constraintsPassed: filtered.length,
      ranked: explorer.length,
      recommended: top.length,
    };

    if (!top.length) {
      return NextResponse.json(
        {
          error: `No unseen journals passed scope, ${policy.replaceAll("_", " ")} eligibility${filters ? `, and ${filters}` : ""} in the current verified evidence pool.`,
          exhausted: true,
          funnel,
        },
        { status: 422 },
      );
    }

    const enrichedTop = await enrichSimilarWork(top, body);
    const fallback: AnalysisResponse = {
      fingerprint: {
        field: body.field || "Inferred from manuscript evidence",
        keywords: body.keywords || [],
        noveltyClaim: "Evaluate against the target journal's recent literature.",
        methodSignal: "Review manuscript methods before submission.",
      },
      journals: enrichedTop,
      rankingExplorer: explorer,
      funnel,
      editorialBoard: {
        verdict:
          "Kagua first uses relevant publications as scope evidence, converts them to candidate journals, applies eligibility and scope, then researcher constraints, KTS/KPOS ranking, and finally the five-journal Decision Room.",
        strengths: ["Live publication evidence", "Scope-first ranking", "Auditable funnel", "Top-50 explorer", "Human-governed final selection"],
        concerns: ["Unknown licensed metrics remain unverified when strict locks are active"],
        actions: ["Review the recommended five", "Open the Top-50 ranking explorer", "Inspect Why this rank? evidence", "Request five more if no consensus"],
      },
      evidenceNote: `Relevant publications are evidence for journal scope; journals are the entities ranked. Live sources: ${ev.sources.join(", ")}. DHET edition: ${DHET_EDITION}.`,
      evidenceRun: { generatedAt: new Date().toISOString(), candidateSources: ev.sources, dhetEdition: DHET_EDITION, liveEvidence: true },
      eligibilityRun: {
        policy,
        customListName: body.customJournalList?.name,
        customListEntries: body.customJournalList?.entries.length || 0,
        preFilter: ranked.length,
        eligiblePool: filtered.length,
      },
      llmModeUsed: "none",
      decisionRun: {
        batchSize: body.batchSize || 5,
        returned: top.length,
        excludedCount: body.excludeJournalIds?.length || 0,
        hasMore: filtered.length > top.length,
        eligiblePoolSize: filtered.length,
      },
    };

    return NextResponse.json(await enrichWithLlm(body, fallback, explorer.slice(0, 15)));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: 502 });
  }
}
