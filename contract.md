/goal

# Contract: Dashboard Live Events, Goals, Files, And Spend

## Objective

Turn the Agent Runner dashboard into a live, low-cost operations view for Codex jobs.

The dashboard should show:
- What the agent is doing now.
- What files it has inspected, edited, created, or deleted.
- How the job is progressing against the original prompt/contract.
- Which subgoals the main agent appears to be working through.
- How much subscription budget and DigitalOcean spend the task appears to consume.

The result should feel like an animated, readable agent transcript without making raw logs the primary UI and without burning through Cloudflare D1 Free write limits.

Primary areas:
- Runner/dashboard observer in `src/commands/dashboard.ts`.
- Dashboard ingest/API files in `dashboard/functions/api`.
- Dashboard UI in `dashboard/public/index.html`, `dashboard/public/styles.css`, and `dashboard/public/app.js`.
- Tests covering parsing, normalization, write-efficient payload behavior, spend math, and API compatibility.

Do not commit or push.

## Core Architecture

Use Cloudflare D1 as the storage backend for this pass.

Do not add Supabase, MongoDB, Hyperdrive, WebSockets, or a second storage system unless D1 metrics prove that D1 is the blocker.

To protect D1 writes:
- Live telemetry should be sent as a bounded snapshot roughly once per minute while a job is running.
- Observer/goal summaries should continue roughly every 5 minutes.
- The live snapshot should update one existing `jobs` row whenever possible.
- Durable history should be inserted sparingly: every observer interval, on major status changes, and on terminal states.
- Do not insert one D1 row per live event.
- Do not store raw log tails in recurring history.
- Avoid per-ingest cleanup deletes; use bounded snapshots or occasional cleanup.

The browser can animate newly observed events by diffing the latest snapshot client-side.

## Launch Gate

Dashboard reporting is mandatory for this work.

No remote implementation job should be considered successfully launched unless:
- `AGENT_RUNNER_DASHBOARD_ENDPOINT` is configured.
- `AGENT_RUNNER_DASHBOARD_TOKEN` is configured.
- The runner reports `dashboard.enabled: true` in resolved config.
- The started task creates a dashboard observer session.
- The dashboard receives at least one ingest for the new task.
- The task appears in `GET /api/jobs` before the launch is accepted.

If dashboard reporting is missing or the observer cannot start, abort the remote job and tear down any managed droplet created for it. A local `doctor` result of `dashboard: not set; optional` is not acceptable for this contract.

## Product Direction

Keep the dashboard dark, compact, premium, and operational.

The first read should answer:
- Is the job alive?
- What is it doing?
- What changed recently?
- Which files are involved?
- Which contract goals are done, active, blocked, or not started?
- How much of the weekly subscription allocation has this likely consumed?

Raw logs are debugging material, not the main product.

## Required Improvements

1. Live Event Extraction
   - Parse recent Codex JSONL/log output into compact structured events without an extra LLM call.
   - Capture event types such as:
     - `agent_message`
     - `command_started`
     - `command_finished`
     - `file_read`
     - `file_edited`
     - `file_created`
     - `file_deleted`
     - `patch_applied`
     - `tool_call`
     - `error`
     - `status_changed`
   - Each event should include:
     - stable id or hash,
     - timestamp when known,
     - type,
     - short label,
     - optional detail,
     - severity/status,
     - optional file path,
     - optional command/tool metadata.
   - Keep the event snapshot bounded, for example latest 100-300 events per job.
   - If event parsing is uncertain, mark the event as inferred or low-confidence.

2. One-Minute Live Snapshot
   - Add a cheap live telemetry path that sends snapshots about once per minute while the job is running.
   - The snapshot should include:
     - latest live events,
     - aggregated file activity,
     - current activity,
     - progress if known,
     - token usage if available,
     - last parsed log cursor/checkpoint if useful.
   - Store the snapshot mostly as an update to the `jobs` row or equivalent one-row-per-job state.
   - Do not write each event as a separate D1 row.
   - Keep existing 5-minute observer summary behavior for higher-level goal/progress interpretation.

3. Contract Goals And Subgoals
   - The observer should read and preserve the initial prompt/contract context for the job.
   - Derive a compact set of top-level completion goals from the initial prompt/contract.
   - Track goal states over time:
     - `not_started`
     - `active`
     - `complete`
     - `blocked`
     - `unknown`
   - Observe and report subgoals the main agent appears to be working on.
   - Subgoals may come from:
     - explicit task lists in the prompt/contract,
     - agent plan/checklist messages,
     - progress updates,
     - observed commands/files/events.
   - Preserve confidence and evidence source for goals, but do not add bulky evidence text to the UI.
   - Goal summaries should be refreshed at the existing observer cadence, roughly every 5 minutes, and on terminal status.
   - The dashboard should present goals visually, not as raw JSON:
     - completion progress,
     - current/active goal,
     - blocked goals,
     - completed goals,
     - observed subgoals grouped under the main goal when possible.

4. Animated Agent Transcript UI
   - Replace raw-log-first display with a polished activity transcript built from structured events.
   - The transcript should feel live:
     - newly observed events animate in subtly,
     - running jobs show a restrained live indicator,
     - event groups are easy to scan.
   - Provide filters or tabs for:
     - activity,
     - files,
     - commands,
     - errors.
   - Keep raw logs hidden behind an inspect/debug affordance if still available.
   - If no structured events exist, show a concise empty state rather than falling back to a giant raw tail.

5. Files Touched View
   - Aggregate file activity from parsed events and patches.
   - Show:
     - path,
     - latest action,
     - read/edit/create/delete counts,
     - last seen time,
     - confidence/source.
   - Make edited/created/deleted files visually distinct from read-only files.
   - Long paths must truncate gracefully and expose full path on hover/title.
   - Do not create one D1 row per file event for this pass; store bounded aggregate state per job.

6. Subscription-Based Codex Spend
   - Replace or de-emphasize API-price-style Codex cost as the primary Codex number.
   - Model Codex spend as allocation against a weekly subscription budget.
   - Support configuration for:
     - monthly subscription price, e.g. `$100` for Pro,
     - seat/user multiplier, e.g. `5`,
     - weekly budget calculation,
     - weekly token allowance or observed weekly token usage when available,
     - current task token usage.
   - Display:
     - weekly budget dollars,
     - current task token usage,
     - estimated task share of weekly allocation,
     - remaining weekly budget,
     - confidence/source label such as `configured`, `observed`, `estimated`, or `missing_tokens`.
   - Keep DigitalOcean cost separate and clear.
   - If token usage is missing, show runtime/elapsed allocation with low confidence instead of pretending exactness.

7. Spend Dashboard Summary
   - Add a compact spend panel showing:
     - Codex weekly budget,
     - current task Codex allocation estimate,
     - DigitalOcean estimate,
     - total operational estimate,
     - confidence/source.
   - Completed jobs should preserve final spend snapshots.
   - Running jobs should update spend estimates as token data arrives.

8. Data Model And Compatibility
   - Preserve existing ingest compatibility. Existing payloads with only `summary`, `status`, and `logTail` must still work.
   - Add optional structured fields, preferably under a versioned telemetry object such as `telemetry`.
   - If D1 schema changes are needed, add a new migration instead of editing the existing migration.
   - Keep Cloudflare Access-protected browser reads and token-protected `/api/ingest` writes working.
   - Store raw log tails only as latest debug context if needed; do not store raw tails in every durable history row.

9. UI States And Ergonomics
   - Running jobs should feel live without being noisy.
   - Stuck or failed jobs should surface the relevant blocker/error event quickly.
   - Goals should make progress and uncertainty visible.
   - Empty telemetry states should explain that structured activity has not arrived yet.
   - Mobile around `390px` width must support scanning:
     - jobs,
     - live transcript,
     - files touched,
     - goals,
     - spend.
   - Avoid overlaps, clipped text, and layout shifts.

## Suggested Implementation Plan

1. Inspect sample Codex JSONL/log output and identify parseable event shapes.
2. Add pure helpers for:
   - event extraction,
   - file activity aggregation,
   - token usage extraction,
   - weekly subscription spend calculation.
3. Extend observer payload generation with minute-level live telemetry snapshots.
4. Extend the 5-minute observer summary to include contract goals and observed subgoals.
5. Add D1 migration/API normalization for structured telemetry if needed.
6. Update dashboard UI with:
   - animated event transcript,
   - files touched view,
   - goals/subgoals view,
   - subscription spend panel.
7. Improve polling so running jobs refresh at a useful cadence without excessive reads.
8. Add tests for parsing, normalization, spend math, and backward-compatible ingest.
9. Validate visually on populated, empty, mobile, and long-text states.

## Write Budget Guidance

Design target for each continuously running job:
- Live snapshot: about 1 update/minute, roughly 1,440 updates/day.
- Observer summary/history: about 1 insert/5 minutes, roughly 288 inserts/day.
- Terminal/failure/status-change inserts: occasional.

Avoid:
- one row per event,
- one row per file mention,
- deletes on every ingest,
- large indexed JSON churn when only non-indexed live fields changed,
- recurring full raw-log history.

This should keep a small number of continuously running jobs comfortably below D1 Free write limits.

## Non-Goals

Do not:
- Add a frontend framework or heavy dependency.
- Add Supabase, MongoDB, Hyperdrive, or another persistence layer in this pass.
- Run an additional Codex/LLM just to parse live events.
- Make raw logs the primary UI.
- Change DigitalOcean lifecycle.
- Change sync/pull/push behavior.
- Change Codex task execution semantics.
- Store secrets in the dashboard or generated artifacts.
- Commit `.wrangler`, `node_modules`, screenshots, or temporary sample data.

## Follow-Up Ideas

These are intentionally not required for the first pass:
- Long-term per-event analytics tables if D1 metrics prove safe.
- Per-project weekly budget caps and alerts.
- Job-to-job cost comparison charts.
- File diff previews in the dashboard.
- Command duration timeline.
- “Open in editor/GitHub” links for changed files.
- Exportable weekly spend report.
- SSE/WebSocket live mode if polling becomes limiting.
- Alternative storage only after real D1 metrics show pressure.

## Validation

Run:

```bash
npm run check
npm test
npm run build
```

Also validate dashboard rendering locally if the environment allows it:

```bash
cd dashboard
AGENT_RUNNER_DASHBOARD_TOKEN=dev-token npm run dev
```

Verify these APIs still behave:
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/ingest`

Create or ingest temporary local sample jobs representing:
- One running job with live events and edited files.
- One running job with contract goals and active subgoals.
- One completed job with goals complete and final spend.
- One running job without token usage, showing low-confidence spend.
- One stuck job with blockers and error events.
- One failed job.
- One very long project slug, task id, goal, and file path.

Inspect:
- Desktop around `1440x900`.
- Mobile around `390x844`.
- Populated state.
- Empty telemetry state.
- Empty goals state.
- Long text stress case.

## Acceptance Criteria

The dashboard should make it obvious, at a glance, what Codex is doing, which files are involved, and how the job is progressing against the original prompt/contract.

Live activity should feel chat-like and animated while remaining write-efficient.

The remote job must launch with dashboard reporting active. No dashboard observer means no successful launch.

Spend should read as a practical subscription-budget approximation, with DigitalOcean cost separate and confidence clearly labeled.

Old ingest payloads should continue to work.

D1 writes should remain bounded by minute-level snapshots and sparse durable summaries, not per-event inserts.

The implementation should stay small enough to review comfortably.

Final response should include:
- Files changed.
- New live telemetry behavior.
- New goals/subgoals behavior.
- New spend behavior.
- D1 write-budget decisions.
- Backward compatibility notes.
- Screenshot/inspection method used.
- Validation commands and results.
- Any deferred follow-up ideas.
