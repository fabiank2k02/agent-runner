# Agent Runner Dashboard

Cloudflare Pages app for consolidated Agent Runner job status.

## Setup

```bash
cd dashboard
npm install
```

Create a D1 database:

```bash
npm run db:create
```

Copy the returned `database_id` into `wrangler.toml`, then apply migrations:

```bash
npm run db:migrate
```

Set the shared ingest token as a Pages secret or Pages environment variable:

```bash
npm run wrangler -- pages secret put AGENT_RUNNER_DASHBOARD_TOKEN --project-name agent-runner-dashboard
```

Deploy:

```bash
npm run deploy
```

The scripts accept either `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_TOKEN`.

## Cloudflare Access

Protect the human dashboard with Cloudflare Access:

- `agent-runner-dashboard.pages.dev` should require the Cloudflare identity provider, ideally restricted to members of your Cloudflare account.
- `agent-runner-dashboard.pages.dev/api/ingest` should be a more-specific bypass app, because runners authenticate with `AGENT_RUNNER_DASHBOARD_TOKEN`.
- `GET /api/jobs` and `GET /api/jobs/:id` accept a Cloudflare Access-authenticated request, so the browser does not need a separate dashboard token.

Local dev:

```bash
AGENT_RUNNER_DASHBOARD_TOKEN=dev-token npm run dev
```

## Runner Env

Set these in each repo/Codespace that should report to the dashboard:

```bash
AGENT_RUNNER_DASHBOARD_ENDPOINT=https://agent-runner-dashboard.pages.dev/api/ingest
AGENT_RUNNER_DASHBOARD_TOKEN=your-shared-dashboard-token
AGENT_RUNNER_DASHBOARD_MODEL=gpt-5.4-mini
AGENT_RUNNER_DASHBOARD_DO_HOURLY_USD=
AGENT_RUNNER_CODEX_SUBSCRIPTION_USD=
AGENT_RUNNER_CODEX_SUBSCRIPTION_SEATS=
AGENT_RUNNER_CODEX_SUBSCRIPTION_TOKENS=
AGENT_RUNNER_CODEX_WEEKLY_TOKEN_ALLOWANCE=
AGENT_RUNNER_CODEX_OBSERVED_WEEKLY_TOKENS=
```

`agent-runner run` and `agent-runner start` require the endpoint, token, and resolved `dashboard.enabled: true`. A launch is accepted only after the runner starts the observer session, the dashboard receives an ingest for the task, and the task appears in `GET /api/jobs`.

The observer reads only the prompt, status file, and bounded JSONL log tail. It posts a cheap live telemetry snapshot about once per minute, and durable observer summaries about every 5 minutes plus terminal states. Live snapshots update the `jobs` row with structured events, file activity, goals, token usage, and spend. Summary/terminal payloads create sparse history rows. The ingest API still accepts legacy `summary`/`status`/`logTail` payloads.

Codex spend is shown as weekly subscription allocation, not API-price-style token billing. Configure monthly subscription price, optional seat multiplier, and weekly or observed token allowance when available. If task token usage is missing, the UI falls back to low-confidence runtime allocation. DigitalOcean spend remains separate.
