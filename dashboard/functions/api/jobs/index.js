import { authenticateApiRequest, cors, json } from "../../_shared/auth.js";
import { classifyJob } from "../../_shared/job-truth.js";
import { estimateJobCodexCost } from "../../_shared/usage.js";

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
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? requestedLimit : 20));
  const result = await env.DB.prepare(
    `SELECT jobs.id, jobs.project_slug, jobs.task_id, jobs.session_name, jobs.observer_session_name, jobs.remote_host,
      jobs.status, jobs.exit_code, jobs.started_at, jobs.finished_at, jobs.updated_at, jobs.last_seen_at,
      jobs.current_activity, jobs.is_stuck, jobs.progress_percent, jobs.progress_confidence,
      jobs.eta_minutes_min, jobs.eta_minutes_max, jobs.eta_confidence, jobs.summary_json, jobs.status_json, jobs.log_file,
      jobs.last_raw_telemetry_at, jobs.raw_chunk_count, jobs.raw_payload_available, jobs.raw_status,
      ps.status AS processed_status, ps.summary AS processed_summary, ps.latest_activity AS processed_latest_activity,
      ps.next_action AS processed_next_action, ps.token_usage_json AS processed_token_usage_json,
      ps.cost_json AS processed_cost_json,
      ps.deterministic_version AS deterministic_version, ps.model_version AS model_version,
      ps.processed_through_sequence AS processed_through_sequence, ps.processed_at AS processed_at,
      NULL AS processed_metadata_json
     FROM jobs
     LEFT JOIN processed_streams ps ON ps.id = 'runner-job:' || jobs.project_slug || ':' || jobs.task_id
     ORDER BY updated_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  return cors(json({ jobs: (result.results || []).map((row) => mapJobRow(row, { env })) }));
}

function mapJobRow(row, context = {}) {
  const truth = classifyJob(row, context);
  return {
    id: row.id,
    projectSlug: row.project_slug,
    taskId: row.task_id,
    sessionName: row.session_name,
    observerSessionName: row.observer_session_name,
    remoteHost: row.remote_host,
    status: truth.status,
    reportedStatus: truth.reportedStatus,
    truth,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    currentActivity: row.current_activity,
    isStuck: Boolean(row.is_stuck),
    progressPercent: row.progress_percent,
    progressConfidence: row.progress_confidence,
    etaMinutesMin: row.eta_minutes_min,
    etaMinutesMax: row.eta_minutes_max,
    etaConfidence: row.eta_confidence,
    summary: parseJson(row.summary_json, {}),
    statusJson: parseJson(row.status_json, {}),
    telemetry: parseJson(row.telemetry_json, null),
    logFile: row.log_file,
    rawTelemetry: {
      latestRawTelemetryAt: row.last_raw_telemetry_at,
      rawChunkCount: row.raw_chunk_count || 0,
      rawPayloadAvailable: Boolean(row.raw_payload_available),
      rawStatus: row.raw_status,
      rawAgeSeconds: ageSeconds(row.last_raw_telemetry_at),
      rawStale: truth.status === "stale" || isRawStale(truth.status, row.last_raw_telemetry_at, 10 * 60),
      processedAgeSeconds: ageSeconds(row.updated_at),
      processedStale: isProcessedStale(row.status, row.last_raw_telemetry_at, row.updated_at),
      rawAvailableButUnprocessed: Boolean(row.last_raw_telemetry_at && (!row.processed_at || Date.parse(row.last_raw_telemetry_at) - Date.parse(row.processed_at) > 10 * 60 * 1000))
    },
    processed: mapProcessed(row, context)
  };
}

function mapProcessed(row, context = {}) {
  if (!row.processed_at) {
    return null;
  }
  const tokenUsage = parseJson(row.processed_token_usage_json, {});
  const cost = estimateJobCodexCost({
    tokenUsage,
    cost: parseJson(row.processed_cost_json, {}),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    env: context.env || {}
  });
  return {
    status: row.processed_status,
    summary: row.processed_summary,
    latestActivity: row.processed_latest_activity,
    nextAction: row.processed_next_action,
    blockers: parseJson(row.processed_blocker_json, []),
    files: parseJson(row.processed_files_json, []),
    tokenUsage,
    cost,
    linkedStreams: parseJson(row.processed_linked_streams_json, []),
    deterministicVersion: row.deterministic_version,
    modelVersion: row.model_version,
    processedThroughSequence: row.processed_through_sequence || 0,
    processedAt: row.processed_at,
    metadata: parseJson(row.processed_metadata_json, {}),
    freshness: {
      processedAgeSeconds: ageSeconds(row.processed_at),
      processedStale: isProcessedStale(row.status, row.last_raw_telemetry_at, row.processed_at)
    }
  };
}

function ageSeconds(value) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.round((Date.now() - timestamp) / 1000)) : null;
}

function isRawStale(status, value, staleSeconds) {
  if (["completed", "failed", "stopped"].includes(status)) {
    return false;
  }
  const age = ageSeconds(value);
  return age === null ? false : age > staleSeconds;
}

function isProcessedStale(status, rawAt, processedAt) {
  if (["completed", "failed", "stopped"].includes(status) || !rawAt || !processedAt) {
    return false;
  }
  return Date.parse(rawAt) - Date.parse(processedAt) > 10 * 60 * 1000;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
