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
    `SELECT id, source_kind, source_id, stream_kind, project_slug, thread_id, title,
      status, latest_activity, created_at, updated_at, last_telemetry_at,
      latest_raw_telemetry_at, token_usage_json, linked_runner_job_id,
      raw_chunk_count, metadata_json
     FROM local_threads
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
      rawStale: isRawStale(row.status, row.latest_raw_telemetry_at, 45 * 60)
    }
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
