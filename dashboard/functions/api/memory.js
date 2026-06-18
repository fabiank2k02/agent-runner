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
  const includeSuperseded = url.searchParams.get("includeSuperseded") === "true";
  const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") || "100", 10)));
  const result = await env.DB
    .prepare(
      `SELECT id, project_slug, memory_kind, title, body, evidence_strength,
        model_confidence, evidence_json, created_at, updated_at, superseded_by, metadata_json
       FROM project_memory
       WHERE (? = '' OR project_slug = ?)
         AND (? = 1 OR superseded_by IS NULL)
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .bind(projectSlug, projectSlug, includeSuperseded ? 1 : 0, limit)
    .all();

  return cors(json({ memories: (result.results || []).map(mapMemoryRow) }));
}

function mapMemoryRow(row) {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    memoryKind: row.memory_kind,
    title: row.title,
    body: row.body,
    evidenceStrength: row.evidence_strength,
    modelConfidence: row.model_confidence,
    evidence: parseJson(row.evidence_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supersededBy: row.superseded_by,
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
