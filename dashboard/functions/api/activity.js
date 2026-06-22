import { authenticateApiRequest, cors, json } from "../_shared/auth.js";
import { classifyJob } from "../_shared/job-truth.js";

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ request, env }) {
  const auth = authenticateApiRequest(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  if (!env.DB) {
    return cors(json({ error: "D1 binding DB is not configured" }, 500));
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "40", 10)));
  const jobs = await env.DB.prepare(
    `SELECT jobs.id, jobs.project_slug, jobs.task_id, jobs.status, jobs.exit_code, jobs.started_at, jobs.last_seen_at,
      jobs.updated_at, jobs.current_activity, jobs.summary_json, jobs.status_json,
      jobs.last_raw_telemetry_at, jobs.raw_chunk_count,
      ps.summary AS processed_summary, ps.latest_activity AS processed_latest_activity,
      ps.next_action AS processed_next_action, ps.processed_at AS processed_at
     FROM jobs
     LEFT JOIN processed_streams ps ON ps.id = 'runner-job:' || jobs.project_slug || ':' || jobs.task_id
     ORDER BY updated_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();
  const threads = await env.DB.prepare(
    `SELECT local_threads.id, local_threads.source_kind, local_threads.project_slug, local_threads.thread_id, local_threads.title, local_threads.status,
      local_threads.latest_activity, local_threads.updated_at, local_threads.latest_raw_telemetry_at, local_threads.raw_chunk_count,
      ps.summary AS processed_summary, ps.latest_activity AS processed_latest_activity,
      ps.next_action AS processed_next_action, ps.processed_at AS processed_at
     FROM local_threads
     LEFT JOIN processed_streams ps ON ps.id = local_threads.id
     ORDER BY updated_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  const items = [
    ...(jobs.results || []).map((job) => {
      const truth = classifyJob(job, { env });
      return {
        type: "runner-job",
        label: "Runner job",
        id: job.id,
        projectSlug: job.project_slug,
        title: job.task_id,
        status: truth.status,
        reportedStatus: truth.reportedStatus,
        truth,
        activity: job.processed_latest_activity || job.current_activity,
        processedSummary: job.processed_summary,
        nextAction: job.processed_next_action,
        processedAt: job.processed_at,
        updatedAt: job.updated_at,
        latestRawTelemetryAt: job.last_raw_telemetry_at,
        rawChunkCount: job.raw_chunk_count || 0
      };
    }),
    ...(threads.results || []).map((thread) => ({
      type: thread.source_kind === "codex-ide-thread" ? "ide-thread" : thread.source_kind === "local-workspace" ? "workspace" : "cli-thread",
      label: thread.source_kind === "codex-ide-thread" ? "IDE thread" : thread.source_kind === "local-workspace" ? "Workspace telemetry" : "CLI thread",
      id: thread.id,
      projectSlug: thread.project_slug,
      title: thread.title || thread.thread_id,
      status: thread.status,
      activity: thread.processed_latest_activity || thread.latest_activity,
      processedSummary: thread.processed_summary,
      nextAction: thread.processed_next_action,
      processedAt: thread.processed_at,
      updatedAt: thread.updated_at,
      latestRawTelemetryAt: thread.latest_raw_telemetry_at,
      rawChunkCount: thread.raw_chunk_count || 0
    }))
  ]
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""))
    .slice(0, limit);

  return cors(json({ activity: items }));
}
