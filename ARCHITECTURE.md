# Kagua production architecture

## Trust boundary

Kagua separates three systems:

1. **Evidence plane**: live scholarly services and versioned official lists.
2. **Decision plane**: deterministic scoring and multi-objective ranking.
3. **Reasoning plane**: optional MoE/LLM scientific/editorial interpretation.

An LLM cannot create or overwrite factual journal metrics unless a source-backed tool returns those facts.

## Evidence Engine v1

### Candidate generation
Crossref and OpenAlex are queried in parallel from the title + abstract. Candidate journals are identified from manuscript-relevant works and merged by normalized ISSN.

### DHET resolution
The official 2025–2026 DHET workbook is materialized into a local, versioned ISSN index at build/repository time. This avoids runtime dependence on the DHET SharePoint endpoint and provides deterministic eligibility checks.

### Provenance
Every evidence item stores source, field, value, observation timestamp, confidence, optional source URL, and a note describing what the value means.

### Missing-data policy
Unknown APC, quartile and decision-time data remain unknown. The scoring engine gives missing cost/time evidence a neutral value rather than assuming cheap/fast. Quartile is never inferred from citation counts.

### Resilience
The providers run independently. One can fail and the other can still generate evidence. If both fail, the request fails closed.

## Production extension points

- `LicensedRanking` adapter for authoritative Q1–Q4/JIF/CiteScore evidence according to licence terms.
- `Publisher` adapters for APC, waivers and publisher-reported turnaround data.
- MCP tool layer exposing evidence retrieval to MoE specialists.
- Persistent cache/observability layer (Redis/Postgres) for high-volume deployment.
- Institution authentication and entitlement checks for licensed data sources.

## Explainable Journal Trilemma v2

Kagua adapts the World Energy Council's trilemma idea to publishing decisions without copying its country index. The visible publishing triangle has three nodes: Scientific & Editorial Fit, Quality & Influence, and Affordability & Access. Fit is the dominant node and also has a hard eligibility threshold, so prestige or low cost cannot compensate for a journal that is out of scope. Publication speed is a separate Publication Pathway indicator used in KPOS. Node scores are 0-100 and receive A/B/C/D balance grades. KTS uses a weighted geometric mean to preserve trade-offs.

Scientific scope is not a fourth compensable node. It is the supremacy gate applied after the balanced opportunity calculation. This prevents a high-impact or inexpensive journal with weak manuscript scope alignment from ranking above a scientifically appropriate target.

The Quality & Influence node supports licensed JCR Journal Impact Factor evidence through the institutional evidence adapter. Raw JIF is displayed; field-normalised JIF percentile is preferred for scoring. OpenAlex 2-year mean citedness and h-index remain explicitly labelled open bibliometric indicators and are never presented as JIF.

## Scoring architecture v2

The production decision hierarchy is:

`Scope eligibility -> KTS (Fit x Quality x Affordability) -> Publication pathway -> KPOS`

- **Scientific & Editorial Fit** is the dominant KTS node and must be >=60/100 to enter the ranked shortlist.
- **Quality & Influence** aggregates verified Quartile/JIF evidence and open bibliometric signals without conflating them.
- **Affordability & Access** evaluates verified APC evidence against the researcher's budget.
- **Speed** is not a KTS node. It is a publication-pathway efficiency signal used in KPOS.
- **Acceptance feasibility** is a decision-support index, never a fabricated acceptance probability.
- **KPOS** combines KTS, speed, feasibility, integrity and evidence confidence; scope is not counted twice.

## Human decision orchestration

Kagua's production recommendation workflow is iterative rather than one-shot:

```text
manuscript
  -> live candidate discovery
  -> scope eligibility floor
  -> KTS + pathway + KPOS ranking
  -> batch of 5 unseen journals
  -> researcher vote + supervisor vote + decision note
       -> consensus on one journal: stop and preserve decision record
       -> no consensus: exclude all previously displayed stable journal IDs
                         -> discover/rank next unseen evidence pool
                         -> return next 5
```

Human votes never mutate KTS/KPOS. They form a separate governance layer so the app can distinguish "the algorithm ranked this journal highly" from "the researcher and supervisor agreed to submit here."

Candidate discovery intentionally retrieves a deeper Crossref/OpenAlex result pool than is enriched in one request. Before expensive source-metric, DOAJ, DHET, and institutional-adapter enrichment, already-seen journal IDs are filtered out. This allows later batches to move deeper into the live discovery pool without repeatedly paying to enrich journals the user has already reviewed.
