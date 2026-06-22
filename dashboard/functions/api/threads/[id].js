import { authenticateApiRequest, cors, json } from "../../_shared/auth.js";

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ request, env, params }) {
  const auth = authenticateApiRequest(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  if (!env.DB) {
    return cors(json({ error: "D1 binding DB is not configured" }, 500));
  }

  const id = decodeURIComponent(params.id || "");
  const thread = await env.DB.prepare(
    `SELECT local_threads.id, local_threads.source_kind, local_threads.source_id, local_threads.stream_kind, local_threads.project_slug, local_threads.thread_id, local_threads.title,
      local_threads.status, local_threads.latest_activity, local_threads.created_at, local_threads.updated_at, local_threads.last_telemetry_at,
      local_threads.latest_raw_telemetry_at, local_threads.token_usage_json, local_threads.linked_runner_job_id,
      local_threads.raw_chunk_count, local_threads.raw_chunk_ids_json, local_threads.metadata_json,
      ps.status AS processed_status, ps.summary AS processed_summary, ps.latest_activity AS processed_latest_activity,
      ps.next_action AS processed_next_action, ps.blocker_json AS processed_blocker_json,
      ps.files_json AS processed_files_json, ps.token_usage_json AS processed_token_usage_json,
      ps.cost_json AS processed_cost_json, ps.linked_streams_json AS processed_linked_streams_json,
      ps.deterministic_version AS deterministic_version, ps.model_version AS model_version,
      ps.processed_through_sequence AS processed_through_sequence, ps.processed_at AS processed_at,
      ps.metadata_json AS processed_metadata_json
     FROM local_threads
     LEFT JOIN processed_streams ps ON ps.id = local_threads.id
     WHERE local_threads.id = ?`
  )
    .bind(id)
    .first();

  if (!thread) {
    return cors(json({ error: "Thread not found" }, 404));
  }

  const chunks = await env.DB.prepare(
    `SELECT id, sequence, r2_key, byte_size, uncompressed_byte_size, sha256,
      created_at, generated_at, cursor_json, metadata_json, terminal_status, payload_inline_json
     FROM telemetry_chunks
     WHERE stream_id = ?
     ORDER BY sequence DESC
     LIMIT 50`
  )
    .bind(id)
    .all();

  let linkedJob = null;
  if (thread.linked_runner_job_id) {
    linkedJob = await env.DB.prepare(
      `SELECT id, project_slug, task_id, status, updated_at, current_activity
       FROM jobs
       WHERE id = ?`
    )
      .bind(thread.linked_runner_job_id)
      .first();
  }

  return cors(json({
    thread: mapThreadRow(thread),
    rawChunks: (chunks.results || []).map(mapChunkRow),
    linkedRunnerJob: linkedJob ? mapLinkedJob(linkedJob) : null,
    latestActivity: latestActivityFromChunks(chunks.results || [])
  }));
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
    rawChunkIds: parseJson(row.raw_chunk_ids_json, []),
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
    cost: sanitizeCost(parseJson(row.processed_cost_json, {})),
    linkedStreams: parseJson(row.processed_linked_streams_json, []),
    deterministicVersion: row.deterministic_version,
    modelVersion: row.model_version,
    processedThroughSequence: row.processed_through_sequence || 0,
    processedAt: row.processed_at,
    metadata: parseJson(row.processed_metadata_json, {})
  };
}

function mapChunkRow(row) {
  return {
    id: row.id,
    sequence: row.sequence,
    r2Key: row.r2_key,
    byteSize: row.byte_size,
    uncompressedByteSize: row.uncompressed_byte_size,
    sha256: row.sha256,
    createdAt: row.created_at,
    generatedAt: row.generated_at,
    cursor: parseJson(row.cursor_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    terminalStatus: row.terminal_status,
    storedInR2: Boolean(row.r2_key),
    inlinePreview: parseInlinePreview(row.payload_inline_json)
  };
}

function parseInlinePreview(value) {
  const parsed = parseJson(value, null);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const payload = parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {};
  return {
    promptSnippets: payload.thread?.promptSnippets || [],
    agentMessageSnippets: payload.thread?.agentMessageSnippets || [],
    commandEvents: payload.thread?.commandEvents || [],
    files: payload.thread?.files || payload.workspace?.dirtyFiles || []
  };
}

function latestActivityFromChunks(chunks) {
  const first = chunks[0];
  if (!first) {
    return [];
  }
  const preview = parseInlinePreview(first.payload_inline_json);
  if (!preview) {
    return [];
  }
  return [
    ...preview.promptSnippets.map((text) => ({ type: "prompt", text })),
    ...preview.agentMessageSnippets.map((text) => ({ type: "agent", text })),
    ...preview.commandEvents.map((event) => ({ type: "command", text: event.command || "", event }))
  ].slice(-20);
}

function mapLinkedJob(row) {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    taskId: row.task_id,
    status: row.status,
    updatedAt: row.updated_at,
    currentActivity: row.current_activity
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
