export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ request, env, params }) {
  const auth = authenticateRead(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  if (!env.DB) {
    return cors(json({ error: "D1 binding DB is not configured" }, 500));
  }

  const id = decodeURIComponent(params.id || "");
  const thread = await env.DB.prepare(
    `SELECT id, source_kind, source_id, stream_kind, project_slug, thread_id, title,
      status, latest_activity, created_at, updated_at, last_telemetry_at,
      latest_raw_telemetry_at, token_usage_json, linked_runner_job_id,
      raw_chunk_count, raw_chunk_ids_json, metadata_json
     FROM local_threads
     WHERE id = ?`
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
      rawStale: isRawStale(row.status, row.latest_raw_telemetry_at, 45 * 60)
    }
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
