# Deploy Kagua on Coolify

Kagua is designed to run on Coolify as a Dockerfile-based application.

## 1. Create the resource

In Coolify choose **Projects -> your project -> + New Resource -> Private Repository (with GitHub App)** and select:

- Repository: `Naphymoro/kagua`
- Branch: `main`
- Build Pack: `Dockerfile`
- Dockerfile location: `/Dockerfile`
- Base directory: `/`

If the repository is public, the public-repository flow also works. For a private repository, use a Coolify GitHub App connection with access to `Naphymoro/kagua`.

## 2. Network

Kagua listens on:

- Container port: `3000`
- Host bind: `0.0.0.0`

The Dockerfile sets `HOSTNAME=0.0.0.0`, `PORT=3000`, and exposes port 3000.

Add your production domain in Coolify. Coolify's proxy should route the domain to port 3000. Enable HTTPS for the domain.

## 3. Environment variables

At minimum configure:

```text
KAGUA_CONTACT_EMAIL=you@institution.edu
```

Optional production variables:

```text
OPENALEX_API_KEY=
KAGUA_LLM_MODE=none
KAGUA_CLOUD_BASE_URL=https://api.openai.com/v1
KAGUA_CLOUD_MODEL=
KAGUA_CLOUD_API_KEY=
KAGUA_LOCAL_BASE_URL=http://127.0.0.1:11434
KAGUA_LOCAL_MODEL=
KAGUA_EVIDENCE_ADAPTER_URL=
KAGUA_EVIDENCE_ADAPTER_TOKEN=
```

Do not commit secrets to GitHub. Configure them in Coolify's Environment Variables UI.

## 4. Build behavior

The Docker build runs `npm run build`. The `prebuild` lifecycle runs `npm run prepare:data`, which retrieves the official DHET 2025-2026 workbook and creates the compressed runtime ISSN index. The build intentionally fails closed if that source cannot be retrieved or produces a suspiciously small index.

The Coolify build server therefore needs outbound HTTPS access to the official DHET source and npm registry.

## 5. Health check

The image contains a Docker health check against:

```text
http://127.0.0.1:3000/api/health
```

After deployment, also verify externally:

```text
https://YOUR-DOMAIN/api/health
```

A healthy response should report `status: ok`, service `kagua`, the Evidence Engine version, and the DHET dataset information.

## 6. Automatic deployment

Enable automatic deployment for `main` in the Coolify Git source configuration. With the GitHub App/webhook configured, pushes to `main` can trigger a new deployment.

## 7. Production smoke test

After the first successful deployment:

1. Open `/api/health` and confirm a healthy response.
2. Open the application and run a manuscript in **Scoring only** mode.
3. Confirm Crossref/OpenAlex live discovery returns candidates.
4. Confirm DHET evidence appears only when ISSN/eISSN matches the official index.
5. Test **None fit - show 5 more** and confirm prior stable journal IDs do not reappear.
6. Test researcher and supervisor decisions until consensus is recorded.
7. If using licensed JIF/quartile evidence, test the institutional evidence adapter separately.
8. Inspect Coolify container logs for API errors and confirm no API keys are logged.

## Troubleshooting

### Build fails while generating DHET data

Check outbound network access from the Coolify build host and inspect the build log for `DHET workbook fetch failed` or the parse-size safety error.

### Container is running but domain gives 502

Confirm the application is routed to port `3000`, the domain is attached to this resource, and `/api/health` succeeds inside the container.

### Local LLM does not work from a deployed browser

`localhost` in browser-local LLM mode refers to the researcher's own computer, not the Coolify server. The local model endpoint must be reachable from that browser and configured to allow the Kagua production origin.
