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
  const job = await env.DB.prepare(
    `SELECT id, project_slug, task_id, session_name, observer_session_name, remote_host,
      status, exit_code, started_at, finished_at, updated_at, last_seen_at,
      current_activity, is_stuck, progress_percent, progress_confidence,
      eta_minutes_min, eta_minutes_max, eta_confidence, summary_json, status_json, telemetry_json, log_file, log_tail,
      last_raw_telemetry_at, raw_chunk_count, raw_payload_available, raw_status
     FROM jobs
     WHERE id = ?`
  )
    .bind(id)
    .first();

  if (!job) {
    return cors(json({ error: "Job not found" }, 404));
  }

  const history = await env.DB.prepare(
    `SELECT id, received_at, generated_at, summary_json, status_json
     FROM summaries
     WHERE job_id = ?
     ORDER BY received_at DESC
     LIMIT 50`
  )
    .bind(id)
    .all();

  const chunks = await env.DB.prepare(
    `SELECT id, sequence, r2_key, byte_size, uncompressed_byte_size, sha256,
      created_at, generated_at, cursor_json, metadata_json, terminal_status
     FROM telemetry_chunks
     WHERE stream_kind = 'runner-job' AND stream_id = ?
     ORDER BY sequence DESC
     LIMIT 50`
  )
    .bind(`runner-job:${job.project_slug}:${job.task_id}`)
    .all();

  return cors(json({
    job: mapJobRow(job),
    history: (history.results || []).map(mapSummaryRow),
    rawChunks: (chunks.results || []).map(mapChunkRow)
  }));
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

function mapJobRow(row) {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    taskId: row.task_id,
    sessionName: row.session_name,
    observerSessionName: row.observer_session_name,
    remoteHost: row.remote_host,
    status: row.status,
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
    logTail: row.log_tail,
    rawTelemetry: {
      latestRawTelemetryAt: row.last_raw_telemetry_at,
      rawChunkCount: row.raw_chunk_count || 0,
      rawPayloadAvailable: Boolean(row.raw_payload_available),
      rawStatus: row.raw_status,
      rawAgeSeconds: ageSeconds(row.last_raw_telemetry_at),
      rawStale: isRawStale(row.status, row.last_raw_telemetry_at, 10 * 60),
      processedAgeSeconds: ageSeconds(row.updated_at),
      processedStale: isProcessedStale(row.status, row.last_raw_telemetry_at, row.updated_at),
      rawAvailableButUnprocessed: Boolean(row.last_raw_telemetry_at && row.updated_at && Date.parse(row.last_raw_telemetry_at) - Date.parse(row.updated_at) > 10 * 60 * 1000)
    }
  };
}

function mapSummaryRow(row) {
  return {
    id: row.id,
    receivedAt: row.received_at,
    generatedAt: row.generated_at,
    summary: parseJson(row.summary_json, {}),
    statusJson: parseJson(row.status_json, {})
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
    storedInR2: Boolean(row.r2_key)
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
