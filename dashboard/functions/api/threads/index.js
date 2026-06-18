export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ request, env }) {
  const auth = authenticateRead(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  if (!env.DB) {
    return cors(json({ error: "D1 binding DB is not configured" }, 500));
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") || "100", 10)));
  const result = await env.DB.prepare(
    `SELECT local_threads.id, local_threads.source_kind, local_threads.source_id, local_threads.stream_kind, local_threads.project_slug, local_threads.thread_id, local_threads.title,
      local_threads.status, local_threads.latest_activity, local_threads.created_at, local_threads.updated_at, local_threads.last_telemetry_at,
      local_threads.latest_raw_telemetry_at, local_threads.token_usage_json, local_threads.linked_runner_job_id,
      local_threads.raw_chunk_count, local_threads.metadata_json,
      ps.status AS processed_status, ps.summary AS processed_summary, ps.latest_activity AS processed_latest_activity,
      ps.next_action AS processed_next_action, ps.blocker_json AS processed_blocker_json,
      ps.files_json AS processed_files_json, ps.token_usage_json AS processed_token_usage_json,
      ps.cost_json AS processed_cost_json, ps.linked_streams_json AS processed_linked_streams_json,
      ps.deterministic_version AS deterministic_version, ps.model_version AS model_version,
      ps.processed_through_sequence AS processed_through_sequence, ps.processed_at AS processed_at,
      ps.metadata_json AS processed_metadata_json
     FROM local_threads
     LEFT JOIN processed_streams ps ON ps.id = local_threads.id
     ORDER BY updated_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  return cors(json({ threads: (result.results || []).map(mapThreadRow) }));
}

function mapThreadRow(row) {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    streamKind: row.stream_kind,
    projectSlug: row.project_slug,
    threadId: row.thread_id,
    title: row.title,
    status: row.status,
    latestActivity: row.latest_activity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTelemetryAt: row.last_telemetry_at,
    latestRawTelemetryAt: row.latest_raw_telemetry_at,
    tokenUsage: parseJson(row.token_usage_json, {}),
    linkedRunnerJobId: row.linked_runner_job_id,
    rawChunkCount: row.raw_chunk_count || 0,
    metadata: parseJson(row.metadata_json, {}),
    freshness: {
      rawAgeSeconds: ageSeconds(row.latest_raw_telemetry_at),
      rawStale: isRawStale(row.status, row.latest_raw_telemetry_at, 45 * 60),
      processedAgeSeconds: ageSeconds(row.processed_at),
      processedStale: isProcessedStale(row.status, row.latest_raw_telemetry_at, row.processed_at)
    },
    processed: mapProcessed(row)
  };
}

function mapProcessed(row) {
  if (!row.processed_at) {
    return null;
  }
  return {
    status: row.processed_status,
    summary: row.processed_summary,
    latestActivity: row.processed_latest_activity,
    nextAction: row.processed_next_action,
    blockers: parseJson(row.processed_blocker_json, []),
    files: parseJson(row.processed_files_json, []),
    tokenUsage: parseJson(row.processed_token_usage_json, {}),
    cost: parseJson(row.processed_cost_json, {}),
    linkedStreams: parseJson(row.processed_linked_streams_json, []),
    deterministicVersion: row.deterministic_version,
    modelVersion: row.model_version,
    processedThroughSequence: row.processed_through_sequence || 0,
    processedAt: row.processed_at,
    metadata: parseJson(row.processed_metadata_json, {})
  };
}

function authenticateRead(request, env) {
  if (request.headers.get("cf-access-jwt-assertion") || request.headers.get("cf-access-authenticated-user-email")) {
    return null;
  }

  const expected = env.AGENT_RUNNER_DASHBOARD_TOKEN || env.AGENT_RUNNER_DASHBOARD_PREVIEW_TOKEN;
  if (!expected) {
    return { status: 500, body: { error: "AGENT_RUNNER_DASHBOARD_TOKEN is not configured" } };
  }
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : request.headers.get("x-agent-runner-token") || "";
  if (token !== expected) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  return null;
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
  if (["completed", "failed", "stopped"].includes(status) || !rawAt) {
    return false;
  }
  if (!processedAt) {
    return true;
  }
  return Date.parse(rawAt) - Date.parse(processedAt) > 10 * 60 * 1000;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function cors(response) {
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  response.headers.set("access-control-allow-headers", "authorization,content-type,x-agent-runner-token");
  return response;
}
