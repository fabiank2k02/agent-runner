# agent-runner

`agent-runner` is a TypeScript CLI for handing a local Codespace project to a VPS, running Codex there for long tasks, and bringing the result back while preserving local drift in Git stash.

Install it once in each Codespace:

```bash
npm install -g github:fabiank2k02/agent-runner
```

Then use it from any project:

```bash
agent-runner init
agent-runner doctor
agent-runner start --prompt-file prompt.md
agent-runner status
agent-runner logs
agent-runner finish
```

## What It Does

- Mirrors the entire project directory to `~/agent-runner/projects/<project-slug>` on the VPS with `rsync --delete`.
- Includes `.git`, dirty tracked files, untracked files, ignored files, `.env*`, and other local project files by default.
- Uses the project `.devcontainer` through the Dev Containers CLI.
- Copies your local Codex auth cache from `~/.codex/auth.json` to `~/agent-runner/secrets/codex/auth.json` on the VPS with mode `600`.
- Injects that auth cache into the devcontainer user home, never into the project workspace.
- Runs long Codex tasks with `codex exec --json` inside named `tmux` sessions, defaulting to xhigh reasoning and yolo mode.
- Can launch an isolated dashboard observer that summarizes task progress and posts it to a Cloudflare Pages dashboard.
- Stashes current local Git changes before pulling the VPS worktree back when the local workspace has changed after the last push.

## Setup

Create a local `.env` or `.env.local` in the project where you run the CLI:

```bash
AGENT_RUNNER_REMOTE_HOST=your.vps.example.com
AGENT_RUNNER_REMOTE_USER=ubuntu
AGENT_RUNNER_REMOTE_PORT=22
AGENT_RUNNER_REMOTE_PASSWORD=your-vps-password
AGENT_RUNNER_REMOTE_ROOT=~/agent-runner
AGENT_RUNNER_CODEX_AUTH_SOURCE=~/.codex/auth.json
DIGITALOCEAN_TOKEN=dop_v1_...
AGENT_RUNNER_DO_REGION=sgp1
AGENT_RUNNER_DO_SIZE=s-2vcpu-4gb
AGENT_RUNNER_DO_IMAGE=ubuntu-24-04-x64
AGENT_RUNNER_DO_DROPLET_NAME=agent-runner-my-project
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

Then initialize per-project config:

```bash
agent-runner init
```

This creates `.agent-runner.json`. If the project already has `.devcontainer/devcontainer.json`, `init` also installs a `postStartCommand` entry that runs `agent-runner telemetry start` whenever the Codespace/devcontainer starts. The hook is idempotent and non-fatal, so it repairs a stopped telemetry service without blocking the container if dashboard credentials are missing. Use `agent-runner init --no-telemetry-autostart` to skip that hook.

Environment values provide secrets and host-specific defaults; the project config can override non-secret defaults such as the project slug, remote root, Codex flags, devcontainer flags, and rsync excludes. Codex tasks default to `reasoningEffort: "xhigh"` and `yolo: true`.

Password auth uses `sshpass` with the password passed through the `SSHPASS` environment variable. The password is not put into command arguments or dry-run output. `doctor` checks for local tools and config only; it does not attempt to log into the VPS.

For managed DigitalOcean droplets, `DIGITALOCEAN_TOKEN` is used only for API calls. The CLI generates a local SSH key under `~/.agent-runner/keys`, uploads the public key to DigitalOcean when needed, and records the active droplet under `~/.agent-runner/digitalocean/<project>.json`. Once that state exists, normal remote commands target the managed droplet even if `.env` still has an old `AGENT_RUNNER_REMOTE_HOST`.

Dashboard reporting is required for remote task launches. `run` and `start` require `AGENT_RUNNER_DASHBOARD_ENDPOINT`, `AGENT_RUNNER_DASHBOARD_TOKEN`, and resolved `dashboard.enabled: true`. The CLI starts a separate observer tmux session, waits until the dashboard receives an ingest for the new task, then verifies the task appears in `GET /api/jobs`. If that launch gate fails, the remote task session is killed; managed droplets created by `start` are destroyed for dashboard launch failures.

The observer uses its own `CODEX_HOME`, reads only the task prompt/status/log tail, posts a bounded live telemetry snapshot about once per minute, and posts durable observer summaries about every 5 minutes plus terminal states. Live snapshots update the latest `jobs` row with structured events, file activity, goals, token usage, and spend; durable history is inserted only for summaries and terminal states. Set `AGENT_RUNNER_DASHBOARD_MODEL` to a cheap mini model for summary interpretation.

Managed DigitalOcean runs record the droplet size's `price_hourly` when available. Override it with `AGENT_RUNNER_DASHBOARD_DO_HOURLY_USD` if needed. Codex spend is modeled as weekly subscription allocation: monthly subscription price times seat multiplier, divided into a weekly budget, then allocated by task tokens when token data and weekly token allowance are available. If tokens are missing, the dashboard shows a low-confidence runtime allocation instead of an exact token cost.

## Commands

Normal managed-DigitalOcean flow:

```bash
agent-runner start "prompt"
agent-runner start --prompt-file prompt.md
agent-runner status
agent-runner logs
agent-runner finish
```

Use either inline prompt form or `--prompt-file`, not both. `start` creates a managed droplet if there is no active/configured remote, pushes the project, starts the remote devcontainer, and launches Codex. Use `--prompt-file prompt.md` for larger prompts or contracts; use `--prompt-file -` to read the prompt from stdin. `finish` pulls the VPS worktree back and destroys the active managed droplet. Use `finish --keep-droplet` if you want to pull without destroying.

Lower-level commands:

```bash
agent-runner doctor
agent-runner bootstrap
agent-runner push
agent-runner up
agent-runner run "prompt"
agent-runner run --prompt-file prompt.md
agent-runner status
agent-runner logs
agent-runner attach
agent-runner stop
agent-runner pull
```

### Lower-Level Command Notes

`doctor` checks local prerequisites, project config, Codex auth, required dashboard configuration, and whether a DigitalOcean token is available. It does not SSH into a VPS.

`bootstrap` prepares an already-configured remote host by installing/checking host tools such as Docker, Node/npm, Dev Containers CLI, Codex, `rsync`, and `tmux`. Managed droplets run this automatically during `droplet create`.

`push` mirrors the current project directory to the remote host and copies your Codex auth cache into the remote runner secrets directory. It records a local manifest so later pulls can tell whether your local tree changed.

`up` starts the project devcontainer on the remote host and injects Codex auth into the devcontainer user's home. It also installs Codex inside the devcontainer when needed.

`run "prompt"` starts a remote Codex task inside a named `tmux` session and returns immediately. Codex output is written to a JSONL log file under the remote runner log directory. For larger prompts, use a file or stdin:

```bash
agent-runner run --prompt-file prompt.md
cat prompt.md | agent-runner run --prompt-file -
```

`status` prints the latest task status, or a specific task if you pass a task id. It reports whether the task is running, completed, or failed, plus the exit code and remote log path when available.

```bash
agent-runner status
agent-runner status 20260616T075216Z-62c8b4
```

`logs` prints the Codex JSONL log for the latest task, or a specific task id. Use `-n` to tail the last N lines.

```bash
agent-runner logs
agent-runner logs -n 80
agent-runner logs 20260616T075216Z-62c8b4 -n 80
```

For a live-ish log view, use your shell's `watch` command:

```bash
watch -n 2 'agent-runner logs -n 40'
```

`attach` connects directly to the remote `tmux` session for a task. This is the closest thing to a live view of the remote job, and it is useful when you want to inspect the session itself. The Codex task still writes its main output to the JSONL log file, so `logs` is usually the cleaner way to read what happened.

```bash
agent-runner attach
agent-runner attach 20260616T075216Z-62c8b4
```

Detach from `tmux` with `Ctrl-b`, then `d`.

`stop` kills the remote `tmux` session for the latest task, or a specific task id.

```bash
agent-runner stop
agent-runner stop 20260616T075216Z-62c8b4
```

`pull` syncs the VPS worktree back to your local project. It first validates that the configured remote project directory exists; if there is no active/configured remote, it fails before touching the local worktree. If your local project changed since the last `push`, it then runs `git stash push --include-untracked`, preserves that stash across the incoming `.git` replacement, then restores it into the pulled repo's stash list.

DigitalOcean lifecycle:

```bash
agent-runner droplet create
agent-runner droplet status
agent-runner push
agent-runner up
agent-runner run "prompt"
agent-runner pull
agent-runner droplet destroy --yes
```

`droplet create` creates a default `s-2vcpu-4gb` Ubuntu droplet, waits for SSH, and runs the same remote bootstrap used for manually-created VPS hosts. After you pull the finished work back, `droplet destroy --yes` deletes the active droplet.

Useful global flags:

```bash
agent-runner --cwd /path/to/project doctor
agent-runner --dry-run push
agent-runner --json status
```

## Remote Layout

```text
~/agent-runner/
  projects/<project-slug>/
  logs/<project-slug>/<task-id>.jsonl
  logs/<project-slug>/<task-id>.observer.log
  logs/<project-slug>/<task-id>.summary.json
  logs/<project-slug>/<task-id>.status.json
  logs/<project-slug>/<task-id>.prompt.txt
  observer/<project-slug>/<task-id>/codex-home/
  secrets/codex/auth.json
  state/<project-slug>.json
```

## Dashboard

The first-party Cloudflare Pages dashboard lives in `dashboard/`. It provides token-protected ingest and Access-or-token-protected read endpoints for consolidated job state:

```text
POST /api/ingest
GET  /api/jobs
GET  /api/jobs/:id
GET  /api/threads
GET  /api/local-threads
GET  /api/processed-streams
GET  /api/memory
GET  /api/processor
POST /api/processor
POST /api/admin/test-cleanup
```

Deploy setup:

```bash
cd dashboard
npm install
npm run db:create
# copy the returned database_id into dashboard/wrangler.toml
npm run db:migrate
npm run wrangler -- pages secret put AGENT_RUNNER_DASHBOARD_TOKEN --project-name agent-runner-dashboard
npm run deploy
```

Use `CLOUDFLARE_TOKEN` for deploy and diagnostics. The dashboard scripts still map it to Wrangler's token environment internally. Use the deployed Pages URL plus `/api/ingest` as `AGENT_RUNNER_DASHBOARD_ENDPOINT` in each repo that should report progress.

The Cloudflare token needs account-level D1 edit and Pages edit permissions. Account Settings read and User Memberships read let Wrangler discover the account automatically.

For the public dashboard, put Cloudflare Access in front of the Pages hostname using Cloudflare as the identity provider, with account-member restriction enabled. Keep `/api/*` as a more-specific Access bypass application so machine API calls reach Pages Functions and receive JSON responses. The functions still require `AGENT_RUNNER_DASHBOARD_TOKEN` or configured `CF-Access-Client-Id` / `CF-Access-Client-Secret` service-token headers, so dashboard data is not public.

The ingest API remains backward-compatible with payloads containing only `summary`, `status`, and `logTail`. New runners send optional `telemetry` snapshots. Live telemetry updates the `jobs.telemetry_json` field and does not create per-event rows. Summary and terminal telemetry create sparse `summaries` history rows, with raw log tails kept only on the latest job row for debugging.

Raw telemetry is still the source of truth. The dashboard also has a disposable processing layer that writes derived summaries, processor status, account usage snapshots, and project memory into additive D1 tables. Raw ingest wakes deterministic processing automatically with conservative stream, chunk, R2 byte, and runtime budgets. Local controls are available for inspection and repair:

```bash
agent-runner telemetry autostart install
agent-runner telemetry autostart status
agent-runner telemetry process-once
agent-runner telemetry processor start
agent-runner telemetry processor status
agent-runner telemetry processor rebuild --project
```

`telemetry autostart install` adds or repairs the devcontainer startup hook for an existing repo. It preserves existing `postStartCommand` entries by converting them into a named command object when needed. Global npm install cannot safely mutate arbitrary repos by itself, so `agent-runner init` is the per-repo automation point.

Model-backed processing is isolated from Cloudflare Workers and disabled by default; deterministic processing does not require OpenAI API billing.

Local state lives in:

```text
~/.agent-runner/state/<project-slug>.json
~/.agent-runner/digitalocean/<project-slug>.json
~/.agent-runner/keys/<project-slug>_ed25519
```

## Safety Model

`push` records a manifest of the local project before mirroring it to the VPS. `pull` recomputes the local manifest and, if the local project no longer matches the last pushed manifest, runs `git stash push --include-untracked` before syncing the VPS worktree back.

That means remote changes can replace the local worktree while your tracked and untracked local edits remain recoverable in the Git stash for a normal local merge or apply flow.

## Development

This repo includes a devcontainer with Node 24, Codex, Dev Containers CLI, `rsync`, `sshpass`, `tmux`, `jq`, Git, and Docker-outside-of-Docker support.

```bash
npm install
npm run check
npm test
npm run build
```

The remote operations are behind small adapters, so the test suite covers SSH/rsync command construction and task orchestration without requiring VPS access.
