/goal

# Contract: Telemetry Processing And Project Memory

## Objective

Build the next layer on top of the raw telemetry foundation.

The current system stores runner-job, local Codex thread, and workspace telemetry as raw chunks plus indexed metadata. This contract adds a processing layer that turns those raw chunks into useful derived state for the dashboard:

- clearer summaries for local threads and runner jobs,
- project-level memory extracted from repeated activity,
- recommendations and next-action hints,
- better stale/blocker/cost/context predictions,
- links between local Codex threads, workspace state, and remote runner jobs.

Raw telemetry remains the source of truth. Processed output must be disposable, rebuildable, and versioned.

Do not deploy a new long-running job until this contract is reviewed.

## Non-Negotiables

- Keep existing runner launch, ingest, dashboard, and local telemetry behavior working.
- Keep `/api/ingest` backward-compatible with current summary and raw telemetry payloads.
- Keep dashboard UI reads protected by Cloudflare Access.
- Keep ingest protected by the dashboard bearer token.
- Do not make Cloudflare Workers run Codex CLI.
- Do not require OpenAI API billing.
- Do not introduce a new paid always-on service.
- Do not overwrite or mutate raw telemetry chunks.
- Do not treat model output as canonical truth.
- Do not upload secrets, auth caches, private keys, dashboard tokens, or raw `.env` values.

## Architecture

Use three layers:

1. **Raw telemetry**
   - Existing D1 metadata plus R2 raw chunks.
   - Source of truth.
   - Append-only except for deliberate retention cleanup later.

2. **Processing jobs**
   - A background processor claims work from D1.
   - It reads raw chunk metadata from D1 and raw payloads from R2 when needed.
   - It writes processed facts, summaries, memory, and recommendations back to D1.

3. **Dashboard read models**
   - Dashboard reads processed state from compact D1 tables.
   - Dashboard should never need to parse full raw telemetry payloads during normal page load.

The processor should run from an existing environment:

- local machine,
- Codespace,
- future runner-side worker,
- manually triggered CLI command.

It should not require a new VM, managed queue subscription, or permanent server.

## Processor Ownership And Leases

Only one processor should actively process a project at a time.

Add a lightweight D1 lease table, for example:

```sql
processing_leases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
)
```

Behavior:

- processors attempt to acquire `project:{projectSlug}:processor`,
- lease expires automatically if heartbeats stop,
- processor renews while active,
- another worker may take over after expiry,
- CLI status should show current lease owner and expiry.

This should be best-effort, not a distributed-systems science project.

## CLI Surface

Add commands under the existing telemetry namespace or a new processor namespace:

```bash
agent-runner telemetry process-once
agent-runner telemetry processor start
agent-runner telemetry processor stop
agent-runner telemetry processor status
agent-runner telemetry processor rebuild
```

Expected behavior:

- `process-once`: claim lease briefly, process available work, exit.
- `processor start`: run a background loop.
- `processor stop`: stop the local background loop.
- `processor status`: show lease, cursor, last processed chunk, model mode, errors.
- `processor rebuild`: clear processed outputs for a project or stream and rebuild from raw chunks.

Names can change if implementation suggests a cleaner CLI shape, but these workflows must exist.

## Processing Model

Implement processing in two phases.

### Phase 1: Deterministic Processor

This phase must not call an LLM.

It should derive:

- latest activity per stream,
- raw/processed freshness,
- token and cost rollups,
- files touched,
- command and tool activity,
- prompt and agent-message snippets,
- linked runner job ids,
- dirty workspace status,
- likely thread/job status,
- chunk counts and cursor state,
- basic blocker signals from errors, failed commands, or repeated inactivity.

This deterministic pass should be enough for the dashboard to become more useful even without model processing.

### Phase 2: Optional Codex Processor

Add an optional model-backed processing pass that can run where Codex CLI is available.

Use a small configured Codex model with low reasoning effort by default. Do not hardcode a specific unavailable model name; make it configurable through existing Codex config/env.

The model-backed pass should:

- summarize local Codex threads,
- summarize runner jobs from raw telemetry,
- extract project facts and durable memory,
- infer blockers,
- infer next actions,
- identify related threads/jobs,
- compress noisy telemetry into stable dashboard cards.

The processor may call Codex CLI from a local/Codespaces/runner environment. It must not call Codex from Cloudflare Workers.

If Codex/model processing fails, deterministic processing should still succeed and the dashboard should show the last good model output.

## Processed Storage

Add D1 tables for derived state. Suggested tables:

```sql
processed_streams (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  stream_kind TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  latest_activity TEXT,
  next_action TEXT,
  blocker_json TEXT NOT NULL DEFAULT '[]',
  files_json TEXT NOT NULL DEFAULT '[]',
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  cost_json TEXT NOT NULL DEFAULT '{}',
  linked_streams_json TEXT NOT NULL DEFAULT '[]',
  deterministic_version TEXT NOT NULL,
  model_version TEXT,
  prompt_hash TEXT,
  processed_through_sequence INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
)
```

```sql
project_memory (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  memory_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  confidence TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  superseded_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
)
```

```sql
processing_runs (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  chunks_seen INTEGER NOT NULL DEFAULT 0,
  chunks_processed INTEGER NOT NULL DEFAULT 0,
  streams_updated INTEGER NOT NULL DEFAULT 0,
  memories_updated INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}'
)
```

Use additive migrations only.

## Memory Rules

Project memory should be conservative.

Good memory candidates:

- repo conventions,
- architecture decisions,
- deployment facts,
- recurring operational procedures,
- known auth/security constraints,
- project-specific command recipes,
- relationships between dashboard, runners, telemetry, D1, R2, Access, and DigitalOcean.

Bad memory candidates:

- temporary logs,
- speculative ideas,
- secrets,
- private tokens,
- raw prompts copied wholesale,
- one-off command outputs,
- model guesses without evidence.

Every memory item should include evidence pointers:

- source stream id,
- chunk id or sequence range,
- timestamp,
- confidence.

Memory must be editable or supersedable later. Do not delete historical evidence silently.

## Dashboard Changes

Extend the dashboard with processed views:

- **Overview**: processed project state and recent activity.
- **Runner Jobs**: current runner job UI plus processed summary/recommendations.
- **Local Threads**: current local thread UI plus processed summary/recommendations.
- **Memory**: project facts, decisions, procedures, and known constraints.
- **Processor Status**: lease owner, last run, last error, processed-through cursor.

The dashboard should distinguish:

- raw telemetry freshness,
- processed output freshness,
- model output freshness.

Use clear labels. Avoid making model-derived claims look like hard facts.

## Security And Privacy

Keep existing redaction rules and improve them where needed.

The processor must not send raw secrets into model prompts. Before model-backed processing:

- strip known secret keys,
- truncate large payloads,
- use snippets and structured summaries where possible,
- include file paths and metadata more readily than full file contents,
- avoid including raw `.env`, auth cache, SSH keys, dashboard token, Codex auth, Cloudflare token, DigitalOcean token.

If a chunk cannot be safely summarized, process only deterministic metadata and mark model processing skipped.

## Cost Constraints

Default mode should be deterministic-only.

Model processing should be:

- opt-in or manually triggered at first,
- resumable,
- budget-aware,
- bounded by chunk count and token limits,
- able to skip already processed chunks,
- configured to use a small/cheap Codex model with low reasoning effort.

No OpenAI API-key requirement should be introduced.

## Validation

Required validation:

- TypeScript check.
- Unit tests for deterministic processing.
- Unit tests for lease acquire/renew/expiry behavior.
- Unit tests for idempotent processed output updates.
- Unit tests for memory evidence/supersession behavior.
- API tests for processed stream and memory read endpoints.
- CLI smoke tests for `process-once`, `status`, and rebuild behavior.
- Local dev smoke test with sample raw runner and local thread chunks.

If model processing is implemented:

- provide a mock model runner in tests,
- test prompt redaction,
- test model failure fallback,
- test that deterministic output remains available.

## Out Of Scope For This Contract

- Full autonomous Codex Web replacement.
- Cross-repository global memory.
- Browser extension integration beyond current data-model support.
- Real-time streaming updates.
- Retention policy and raw telemetry deletion.
- Team/multi-user permissions beyond current Cloudflare Access setup.
- R2 object download UI for raw payload replay.
- Automatic PR creation or GitHub write actions from processed recommendations.

## Success Criteria

This contract is complete when:

- raw telemetry remains stable and backward-compatible,
- a processor can process existing D1/R2 chunks without new paid infrastructure,
- processed stream summaries appear in dashboard read models,
- project memory can be created with evidence,
- deterministic mode works without Codex/model calls,
- optional model mode is cleanly isolated and safe to disable,
- the dashboard clearly shows processor status and processed freshness,
- all validation checks pass.
