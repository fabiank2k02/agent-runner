# agent-runner

`agent-runner` is a TypeScript CLI for handing a local Codespace project to a VPS, running Codex there for long tasks, and bringing the result back only when the local workspace has not diverged.

It is designed to be invoked from any project:

```bash
npx github:fabiank2k02/agent-runner init
npx github:fabiank2k02/agent-runner doctor
npx github:fabiank2k02/agent-runner bootstrap
npx github:fabiank2k02/agent-runner push
npx github:fabiank2k02/agent-runner up
npx github:fabiank2k02/agent-runner run "finish the feature and verify it"
```

## What It Does

- Mirrors the entire project directory to `~/agent-runner/projects/<project-slug>` on the VPS with `rsync --delete`.
- Includes `.git`, dirty tracked files, untracked files, ignored files, `.env*`, and other local project files by default.
- Uses the project `.devcontainer` through the Dev Containers CLI.
- Copies your local Codex auth cache from `~/.codex/auth.json` to `~/agent-runner/secrets/codex/auth.json` on the VPS with mode `600`.
- Injects that auth cache into the devcontainer user home, never into the project workspace.
- Runs long Codex tasks with `codex exec --json` inside named `tmux` sessions.
- Refuses to sync remote work back if the local Codespace changed after the last push.

## Setup

Create a local `.env` or `.env.local` in the project where you run the CLI:

```bash
AGENT_RUNNER_REMOTE_HOST=your.vps.example.com
AGENT_RUNNER_REMOTE_USER=ubuntu
AGENT_RUNNER_REMOTE_PORT=22
AGENT_RUNNER_REMOTE_PASSWORD=your-vps-password
AGENT_RUNNER_REMOTE_ROOT=~/agent-runner
AGENT_RUNNER_CODEX_AUTH_SOURCE=~/.codex/auth.json
```

Then initialize per-project config:

```bash
agent-runner init
```

This creates `.agent-runner.json`. Environment values provide secrets and host-specific defaults; the project config can override non-secret defaults such as the project slug, remote root, Codex flags, devcontainer flags, and rsync excludes.

Password auth uses `sshpass` with the password passed through the `SSHPASS` environment variable. The password is not put into command arguments or dry-run output. `doctor` checks for local tools and config only; it does not attempt to log into the VPS.

## Commands

```bash
agent-runner doctor
agent-runner bootstrap
agent-runner push
agent-runner up
agent-runner run "prompt"
agent-runner status
agent-runner logs
agent-runner attach
agent-runner stop
agent-runner pull
```

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
  logs/<project-slug>/<task-id>.status.json
  logs/<project-slug>/<task-id>.prompt.txt
  secrets/codex/auth.json
  state/<project-slug>.json
```

Local state lives in:

```text
~/.agent-runner/state/<project-slug>.json
```

## Safety Model

`push` records a manifest of the local project before mirroring it to the VPS. `pull` recomputes the local manifest and refuses to continue if the local project no longer matches the last pushed manifest.

That means remote changes are not allowed to silently overwrite new local Codespace edits. Commit, stash, or otherwise back up local work before pulling.

## Development

This repo includes a devcontainer with Node 24, Codex, Dev Containers CLI, `rsync`, `sshpass`, `tmux`, `jq`, Git, and Docker-outside-of-Docker support.

```bash
npm install
npm run check
npm test
npm run build
```

The remote operations are behind small adapters, so the test suite covers SSH/rsync command construction and task orchestration without requiring VPS access.
