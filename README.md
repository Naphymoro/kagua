# Kagua

Evidence-grounded journal intelligence for researchers.

## Kagua v0.3

Kagua takes a manuscript title + abstract, discovers candidate journals from live scholarly infrastructure, applies an eligibility authority, calculates an explainable Journal Trilemma Score (KTS), adds publication-pathway evidence into KPOS, and returns five journals at a time until researcher and supervisor reach consensus.

### Eligibility authority

**DHET 2025–2026 is the default.** Kagua resolves DHET recognition by normalized ISSN/eISSN against its versioned official index and explains the match on every result.

Researchers can upload a university/institution journal list (XLSX/XLS/CSV/TSV/text) and choose:

- DHET only (default)
- University list only
- DHET OR university list
- Open search

Uploaded lists are matched ISSN-first, with normalized title equality as a secondary fallback. The uploaded list is sent with the analysis request and is not treated as a new global authority.

### Journal Trilemma

The visible triangle is inspired by the World Energy Council's balance concept but uses Kagua's own publishing dimensions:

1. Scientific & Editorial Fit
2. Quality & Influence
3. Affordability & Access

Default strategic weights are 45 / 35 / 20. KTS is a weighted geometric mean, and scope also has a 60/100 eligibility floor. Speed is deliberately outside the triangle and is a Publication Pathway indicator.

### Quality node

When evidence exists, Quality & Influence combines verified quartile, verified field-normalised JIF percentile, OpenAlex two-year mean citedness, and OpenAlex h-index. Missing metrics are not scored as zero; their weights are renormalized across available evidence. Raw JIF is never inferred from OpenAlex.

### Godmode LLM routing

Godmode is DeepSeek-first and provider-neutral. It can attempt configured OpenAI-compatible providers in order and move to the next when a provider is unconfigured, unavailable, rate-limited, returns invalid JSON, or exhausts its output token allowance. The response records every attempt and the model actually selected.

Supported first-class profiles:

- DeepSeek official API
- OpenAI
- OpenRouter
- custom OpenAI-compatible endpoint
- local Ollama-compatible model (browser-local mode)
- deterministic scoring-only mode

The official hosted DeepSeek API is usage-priced; Kagua does **not** label it free. The zero-API-cost option is running an open DeepSeek model locally.

### Environment

See `.env.example`. Godmode checks configured server providers in DeepSeek-first order. BYOK provider configuration can also be sent per analysis request. Never commit API keys.

### Manual

The in-app `/manual` route documents the full schema flow, KTS/KPOS mathematics, node contributions, eligibility logic, evidence confidence, Godmode failover and the five-at-a-time human decision loop.

### Production principles

- No static journal catalogue fallback when live discovery fails.
- Scope fit is supreme and must pass the eligibility floor.
- DHET is the default eligibility authority, not an unexplained badge.
- University lists can override/supplement DHET explicitly.
- Missing JIF/quartile/APC/time evidence remains unknown.
- LLMs interpret; they do not create journal facts.
- Human researcher/supervisor decisions never silently mutate KTS/KPOS.
- Five unseen journals are returned per batch until consensus or evidence exhaustion.

### Run

```bash
npm install
npm run build
npm start
```

Health endpoint: `/api/health`.
