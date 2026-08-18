# Kagua

Evidence-grounded journal intelligence for researchers.

Kagua discovers journals from live scholarly infrastructure, verifies DHET recognition by ISSN, enriches APC and bibliometric evidence, and ranks eligible journals with an explainable Kagua Trilemma Score (KTS) and KPOS publication-opportunity score.

## Kagua Journal Trilemma

The three primary nodes are:

1. Scientific & Editorial Fit
2. Quality & Influence
3. Affordability & Access

Publication speed is a separate Publication Pathway indicator used in KPOS. Scope is supreme: journals below the 60/100 scientific/editorial fit threshold cannot enter the Top 5 regardless of prestige or cost.

Quality & Influence can incorporate verified quartile, authorised JCR Journal Impact Factor percentile, OpenAlex citation performance, and h-index. Missing licensed metrics remain explicitly unverified rather than inferred.

## Five-at-a-time decision loop

Kagua returns five unseen journals at a time. Researcher/student and supervisor independently mark each journal Suitable or Not suitable and may record a note. If neither selects a target, “None fit — show 5 more” excludes every journal already seen and retrieves the next five. The loop stops when both researcher and supervisor approve the same journal or the live evidence pool is exhausted. Human votes never mutate KTS/KPOS.

## Evidence sources

- Crossref: live manuscript-to-literature discovery
- OpenAlex: independent discovery and open bibliometric signals
- DHET: official 2025–2026 accredited-journals workbook, normalized by ISSN during build
- DOAJ: APC/no-APC evidence when available
- Institutional evidence adapter: authorised quartile, JIF, publisher APC and first-decision evidence

## LLM modes

Kagua works without an LLM. It also supports browser-local Ollama-compatible models and cloud BYOK OpenAI-compatible endpoints. Journal facts remain evidence-plane data and cannot be invented by the LLM.

## Local production run

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`. Health check: `GET /api/health`.

## Environment

Copy `.env.example` to `.env.local`. At minimum set `KAGUA_CONTACT_EMAIL` for identified Crossref/OpenAlex requests. Optional variables include `OPENALEX_API_KEY`, cloud/local LLM defaults, and the institutional evidence adapter credentials.

## Deploy from GitHub

This repository is intended to be the source of truth and CI/CD origin. GitHub Pages is not suitable because Kagua uses server-side Next.js API routes.

1. Push/merge to `main`.
2. Confirm GitHub Actions is green. CI installs dependencies, generates the DHET evidence index, typechecks, lints and performs a production Next.js build.
3. Import this GitHub repository into Vercel.
4. Framework preset: Next.js.
5. Add `KAGUA_CONTACT_EMAIL` and any optional server-side environment variables.
6. Deploy.
7. Verify `/api/health` reports `status: ok` and the expected DHET edition.
8. Test scoring-only mode first, then test “show 5 more”, human consensus, local LLM and cloud BYOK separately.

## Production evidence policy

The DHET runtime index is generated from the official workbook during build and the build fails closed if retrieval or parsing is suspicious. Crossref/OpenAlex fail closed when both providers are unavailable. Unknown APC, quartile, JIF and decision-time values remain unknown. Licensed metrics must enter through an authorised adapter with provenance.

See `ARCHITECTURE.md` for the scoring and governance design.
