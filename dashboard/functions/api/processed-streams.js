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
  const projectSlug = url.searchParams.get("projectSlug") || "";
  const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") || "100", 10)));
  const result = await env.DB
    .prepare(
      `SELECT id, project_slug, stream_kind, stream_id, source_kind, status,
        summary, latest_activity, next_action, blocker_json, files_json,
        token_usage_json, cost_json, linked_streams_json, deterministic_version,
        model_version, prompt_hash, processed_through_sequence, processed_at, metadata_json
       FROM processed_streams
       WHERE (? = '' OR project_slug = ?)
       ORDER BY processed_at DESC
       LIMIT ?`
    )
    .bind(projectSlug, projectSlug, limit)
    .all();

  return cors(json({ streams: (result.results || []).map(mapProcessedStreamRow) }));
}

export function mapProcessedStreamRow(row) {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    streamKind: row.stream_kind,
    streamId: row.stream_id,
    sourceKind: row.source_kind,
    status: row.status,
    summary: row.summary,
    latestActivity: row.latest_activity,
    nextAction: row.next_action,
    blockers: parseJson(row.blocker_json, []),
    files: parseJson(row.files_json, []),
    tokenUsage: parseJson(row.token_usage_json, {}),
    cost: parseJson(row.cost_json, {}),
    linkedStreams: parseJson(row.linked_streams_json, []),
    deterministicVersion: row.deterministic_version,
    modelVersion: row.model_version,
    promptHash: row.prompt_hash,
    processedThroughSequence: row.processed_through_sequence || 0,
    processedAt: row.processed_at,
    metadata: parseJson(row.metadata_json, {})
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
