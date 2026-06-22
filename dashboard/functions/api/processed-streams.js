import { authenticateApiRequest, cors, json } from "../_shared/auth.js";

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
    cost: sanitizeCost(parseJson(row.cost_json, {})),
    linkedStreams: parseJson(row.linked_streams_json, []),
    deterministicVersion: row.deterministic_version,
    modelVersion: row.model_version,
    promptHash: row.prompt_hash,
    processedThroughSequence: row.processed_through_sequence || 0,
    processedAt: row.processed_at,
    metadata: parseJson(row.metadata_json, {})
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeCost(cost) {
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) {
    return {};
  }
  const {
    confidence: _confidence,
    digitalOceanConfidence: _digitalOceanConfidence,
    codexAllocationConfidence: _codexAllocationConfidence,
    ...rest
  } = cost;
  return rest;
}
