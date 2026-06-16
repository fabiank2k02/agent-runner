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
AGENT_RUNNER_CODEX_SUBSCRIPTION_TOKENS=
```

When endpoint and token are present, `agent-runner run` and `agent-runner start` launch a second observer tmux session automatically. The observer reads only the prompt, status file, and bounded JSONL log tail, then posts structured progress updates to Pages. Set the dashboard model to a cheaper mini model so progress and ETA summaries do not use the main task model. Cost estimates use managed DigitalOcean hourly pricing when available, plus prorated subscription token cost when the subscription env values are set.
