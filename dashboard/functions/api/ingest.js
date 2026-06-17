const MAX_LOG_TAIL_CHARS = 100000;
const MAX_INLINE_JSON_CHARS = 8192;
const terminalStatuses = new Set(["completed", "failed", "stopped"]);
const localSourceKinds = new Set(["codespace-worker", "codex-cli-thread", "codex-ide-thread", "local-workspace"]);
const sourceKinds = new Set(["runner-job", ...localSourceKinds]);
const streamKinds = new Set(["runner-job", "codex-thread", "workspace"]);

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ request, env }) {
  const auth = authenticate(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  if (!env.DB) {
    return cors(json({ error: "D1 binding DB is not configured" }, 500));
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get("verifyJobId") || "";
  if (!jobId) {
    return cors(json({ error: "verifyJobId is required" }, 400));
  }

  const job = await env.DB.prepare(
    `SELECT id, status, updated_at
     FROM jobs
     WHERE id = ?`
  )
    .bind(jobId)
    .first();

  return cors(json({ exists: Boolean(job), job: job ? { id: job.id, status: job.status, updatedAt: job.updated_at } : null }));
}

export async function onRequestPost({ request, env }) {
  const auth = authenticate(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  if (!env.DB) {
    return cors(json({ error: "D1 binding DB is not configured" }, 500));
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return cors(json({ error: "Expected JSON body" }, 400));
  }

  const now = new Date().toISOString();
  if (payload?.kind === "raw-telemetry") {
    return cors(await handleRawTelemetry(payload, env, now));
  }

  const validation = validatePayload(payload);
  if (validation.error) {
    return cors(json({ error: validation.error }, 400));
  }

  const summary = normalizeSummary(payload.summary);
  const status = normalizeStatus(payload.status);
  const telemetry = normalizeTelemetry(payload.telemetry, summary);
  const projectSlug = payload.projectSlug.trim();
  const taskId = payload.taskId.trim();
  const jobId = `${projectSlug}:${taskId}`;
  const logTail = truncate(typeof payload.logTail === "string" ? payload.logTail : "", MAX_LOG_TAIL_CHARS);
  const statusText = status.status || "unknown";
  const generatedAt = typeof payload.generatedAt === "string" ? payload.generatedAt : now;

  await env.DB.prepare(
    `INSERT INTO jobs (
      id, project_slug, task_id, session_name, observer_session_name, remote_host,
      status, exit_code, started_at, finished_at, updated_at, last_seen_at,
      current_activity, is_stuck, progress_percent, progress_confidence,
      eta_minutes_min, eta_minutes_max, eta_confidence,
      summary_json, status_json, telemetry_json, log_file, log_tail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      session_name = excluded.session_name,
      observer_session_name = excluded.observer_session_name,
      remote_host = excluded.remote_host,
      status = excluded.status,
      exit_code = excluded.exit_code,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at,
      current_activity = excluded.current_activity,
      is_stuck = excluded.is_stuck,
      progress_percent = excluded.progress_percent,
      progress_confidence = excluded.progress_confidence,
      eta_minutes_min = excluded.eta_minutes_min,
      eta_minutes_max = excluded.eta_minutes_max,
      eta_confidence = excluded.eta_confidence,
      summary_json = excluded.summary_json,
      status_json = excluded.status_json,
      telemetry_json = excluded.telemetry_json,
      log_file = excluded.log_file,
      log_tail = excluded.log_tail`
  )
    .bind(
      jobId,
      projectSlug,
      taskId,
      nullableString(payload.sessionName),
      nullableString(payload.observerSessionName),
      nullableString(payload.remoteHost),
      statusText,
      nullableInteger(status.exitCode),
      nullableString(status.startedAt),
      nullableString(status.finishedAt),
      generatedAt,
      now,
      summary.currentActivity,
      summary.isStuck ? 1 : 0,
      summary.progressPercent,
      summary.progressConfidence,
      summary.etaMinutesMin,
      summary.etaMinutesMax,
      summary.etaConfidence,
      JSON.stringify(summary),
      JSON.stringify(status),
      JSON.stringify(telemetry),
      nullableString(payload.logFile),
      logTail
    )
    .run();

  if (shouldStoreDurableHistory(payload, statusText)) {
    await env.DB.prepare(
      `INSERT INTO summaries (job_id, received_at, generated_at, summary_json, status_json, log_tail)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(jobId, now, generatedAt, JSON.stringify(summary), JSON.stringify(status), null)
      .run();

    if (terminalStatuses.has(statusText)) {
      await env.DB.prepare(
        `DELETE FROM summaries
         WHERE job_id = ?
           AND id NOT IN (
             SELECT id FROM summaries WHERE job_id = ? ORDER BY received_at DESC LIMIT 100
           )`
      )
        .bind(jobId, jobId)
        .run();
    }
  }

  return cors(json({ ok: true, id: jobId, receivedAt: now }));
}

async function handleRawTelemetry(payload, env, now) {
  const validation = validateRawEnvelope(payload);
  if (validation.error) {
    return json({ error: validation.error }, 400);
  }

  const envelope = normalizeRawEnvelope(payload, now);
  const serialized = JSON.stringify(envelope);
  const sha256 = await sha256Hex(serialized);
  const streamDbId = streamDatabaseId(envelope);
  const sourceDbId = sourceDatabaseId(envelope);
  const existing = await env.DB.prepare(
    `SELECT id, sha256, r2_key
     FROM telemetry_chunks
     WHERE stream_id = ? AND sequence = ?`
  )
    .bind(streamDbId, envelope.sequence)
    .first();

  if (existing) {
    if (existing.sha256 === sha256) {
      return json({
        ok: true,
        id: existing.id,
        duplicate: true,
        receivedAt: now,
        sha256
      });
    }

    const conflictId = `conflict:${streamDbId}:${envelope.sequence}:${sha256.slice(0, 16)}`;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO telemetry_conflicts (
        id, stream_id, sequence, existing_chunk_id, existing_sha256, received_sha256,
        source_kind, project_slug, task_id, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        conflictId,
        streamDbId,
        envelope.sequence,
        existing.id,
        existing.sha256,
        sha256,
        envelope.sourceKind,
        envelope.projectSlug,
        envelope.streamId,
        now,
        JSON.stringify(envelope.metadata)
      )
      .run();
    return json(
      {
        ok: false,
        error: "Raw telemetry sequence conflict",
        conflict: true,
        streamId: streamDbId,
        sequence: envelope.sequence,
        existingSha256: existing.sha256,
        receivedSha256: sha256
      },
      409
    );
  }

  const r2Key = rawTelemetryKey(envelope, sha256);
  const uncompressedBytes = byteLength(serialized);
  let storedBytes = 0;
  let storedInR2 = false;
  if (env.RAW_TELEMETRY) {
    const compressed = await gzipText(serialized);
    storedBytes = compressed.byteLength;
    await env.RAW_TELEMETRY.put(r2Key, compressed, {
      httpMetadata: {
        contentType: "application/json",
        contentEncoding: "gzip"
      },
      customMetadata: {
        sha256,
        sourceKind: envelope.sourceKind,
        streamKind: envelope.streamKind,
        projectSlug: envelope.projectSlug,
        streamId: envelope.streamId,
        sequence: String(envelope.sequence)
      }
    });
    storedInR2 = true;
  } else {
    storedBytes = uncompressedBytes;
  }

  const chunkId = `chunk:${streamDbId}:${envelope.sequence}:${sha256.slice(0, 16)}`;
  const statusHint = statusHintFromEnvelope(envelope);
  const title = titleFromEnvelope(envelope);
  const latestActivity = activityFromEnvelope(envelope);
  const tokenUsage = tokenUsageFromEnvelope(envelope);
  const linkedRunnerJobId = linkedRunnerJobIdFromEnvelope(envelope);
  const createdAt = createdAtFromEnvelope(envelope);
  const inlineJson = storedInR2 ? null : truncate(serialized, MAX_INLINE_JSON_CHARS);

  await env.DB.prepare(
    `INSERT INTO telemetry_sources (
      id, source_kind, source_id, project_slug, version, first_seen_at, last_seen_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_kind = excluded.source_kind,
      project_slug = excluded.project_slug,
      version = excluded.version,
      last_seen_at = excluded.last_seen_at,
      metadata_json = excluded.metadata_json`
  )
    .bind(
      sourceDbId,
      envelope.sourceKind,
      envelope.sourceId,
      envelope.projectSlug,
      nullableInteger(envelope.metadata.telemetrySchemaVersion) ?? envelope.version,
      now,
      now,
      JSON.stringify(envelope.metadata)
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO telemetry_streams (
      id, source_id, source_kind, stream_kind, stream_id, project_slug, task_id,
      title, status, latest_activity, created_at, updated_at, latest_telemetry_at,
      latest_raw_telemetry_at, terminal_at, token_usage_json, metadata_json, linked_job_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_id = excluded.source_id,
      source_kind = excluded.source_kind,
      stream_kind = excluded.stream_kind,
      title = COALESCE(excluded.title, telemetry_streams.title),
      status = excluded.status,
      latest_activity = COALESCE(excluded.latest_activity, telemetry_streams.latest_activity),
      updated_at = excluded.updated_at,
      latest_telemetry_at = excluded.latest_telemetry_at,
      latest_raw_telemetry_at = excluded.latest_raw_telemetry_at,
      terminal_at = COALESCE(excluded.terminal_at, telemetry_streams.terminal_at),
      token_usage_json = excluded.token_usage_json,
      metadata_json = excluded.metadata_json,
      linked_job_id = COALESCE(excluded.linked_job_id, telemetry_streams.linked_job_id)`
  )
    .bind(
      streamDbId,
      sourceDbId,
      envelope.sourceKind,
      envelope.streamKind,
      envelope.streamId,
      envelope.projectSlug,
      envelope.streamKind === "runner-job" ? envelope.streamId : null,
      title,
      statusHint,
      latestActivity,
      createdAt,
      envelope.generatedAt,
      envelope.generatedAt,
      envelope.generatedAt,
      terminalStatuses.has(statusHint) ? envelope.generatedAt : null,
      JSON.stringify(tokenUsage),
      JSON.stringify(envelope.metadata),
      linkedRunnerJobId
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO telemetry_chunks (
      id, source_id, stream_id, source_kind, stream_kind, project_slug, task_id,
      sequence, r2_key, byte_size, uncompressed_byte_size, sha256, created_at,
      generated_at, cursor_json, metadata_json, terminal_status, payload_inline_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      chunkId,
      sourceDbId,
      streamDbId,
      envelope.sourceKind,
      envelope.streamKind,
      envelope.projectSlug,
      envelope.streamKind === "runner-job" ? envelope.streamId : null,
      envelope.sequence,
      storedInR2 ? r2Key : null,
      storedBytes,
      uncompressedBytes,
      sha256,
      now,
      envelope.generatedAt,
      JSON.stringify(envelope.cursor),
      JSON.stringify(envelope.metadata),
      terminalStatuses.has(statusHint) ? statusHint : null,
      inlineJson
    )
    .run();

  if (envelope.streamKind === "runner-job") {
    await env.DB.prepare(
      `UPDATE jobs
       SET last_raw_telemetry_at = ?,
           raw_chunk_count = COALESCE(raw_chunk_count, 0) + 1,
           raw_payload_available = 1,
           raw_status = ?
       WHERE id = ?`
    )
      .bind(envelope.generatedAt, statusHint, `${envelope.projectSlug}:${envelope.streamId}`)
      .run();
  }

  if (localSourceKinds.has(envelope.sourceKind)) {
    await env.DB.prepare(
      `INSERT INTO local_threads (
        id, source_kind, source_id, stream_kind, project_slug, thread_id, title,
        status, latest_activity, created_at, updated_at, last_telemetry_at,
        latest_raw_telemetry_at, token_usage_json, linked_runner_job_id,
        raw_chunk_count, raw_chunk_ids_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        stream_kind = excluded.stream_kind,
        project_slug = excluded.project_slug,
        title = COALESCE(excluded.title, local_threads.title),
        status = excluded.status,
        latest_activity = COALESCE(excluded.latest_activity, local_threads.latest_activity),
        updated_at = excluded.updated_at,
        last_telemetry_at = excluded.last_telemetry_at,
        latest_raw_telemetry_at = excluded.latest_raw_telemetry_at,
        token_usage_json = excluded.token_usage_json,
        linked_runner_job_id = COALESCE(excluded.linked_runner_job_id, local_threads.linked_runner_job_id),
        raw_chunk_count = local_threads.raw_chunk_count + 1,
        raw_chunk_ids_json = excluded.raw_chunk_ids_json,
        metadata_json = excluded.metadata_json`
    )
      .bind(
        streamDbId,
        envelope.sourceKind,
        sourceDbId,
        envelope.streamKind,
        envelope.projectSlug,
        envelope.streamId,
        title,
        statusHint,
        latestActivity,
        createdAt,
        envelope.generatedAt,
        envelope.generatedAt,
        envelope.generatedAt,
        JSON.stringify(tokenUsage),
        linkedRunnerJobId,
        1,
        JSON.stringify([chunkId]),
        JSON.stringify(envelope.metadata)
      )
      .run();
  }

  return json({
    ok: true,
    id: chunkId,
    streamId: streamDbId,
    sourceId: sourceDbId,
    r2Key: storedInR2 ? r2Key : null,
    sha256,
    receivedAt: now
  });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "Payload must be an object" };
  }
  if (typeof payload.projectSlug !== "string" || !payload.projectSlug.trim()) {
    return { error: "projectSlug is required" };
  }
  if (typeof payload.taskId !== "string" || !payload.taskId.trim()) {
    return { error: "taskId is required" };
  }
  if (!payload.summary || typeof payload.summary !== "object") {
    return { error: "summary is required" };
  }
  return {};
}

function validateRawEnvelope(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "Payload must be an object" };
  }
  if (payload.version !== 1) {
    return { error: "raw telemetry version must be 1" };
  }
  if (!sourceKinds.has(payload.sourceKind)) {
    return { error: "sourceKind is invalid" };
  }
  if (payload.streamKind !== undefined && !streamKinds.has(payload.streamKind)) {
    return { error: "streamKind is invalid" };
  }
  if (typeof payload.projectSlug !== "string" || !payload.projectSlug.trim()) {
    return { error: "projectSlug is required" };
  }
  if (typeof payload.streamId !== "string" || !payload.streamId.trim()) {
    return { error: "streamId is required" };
  }
  if (!Number.isInteger(payload.sequence) || payload.sequence < 0) {
    return { error: "sequence must be a non-negative integer" };
  }
  if (!payload.payload || typeof payload.payload !== "object" || Array.isArray(payload.payload)) {
    return { error: "payload object is required" };
  }
  return {};
}

function normalizeRawEnvelope(payload, now) {
  const sourceKind = payload.sourceKind;
  return {
    version: 1,
    kind: "raw-telemetry",
    sourceKind,
    sourceId: truncate(nullableString(payload.sourceId) || `${sourceKind}:${payload.projectSlug}`, 240),
    streamKind: payload.streamKind || defaultStreamKind(sourceKind),
    projectSlug: truncate(payload.projectSlug.trim(), 120),
    streamId: truncate(payload.streamId.trim(), 240),
    sequence: payload.sequence,
    generatedAt: nullableString(payload.generatedAt) || now,
    cursor: payload.cursor && typeof payload.cursor === "object" && !Array.isArray(payload.cursor) ? payload.cursor : {},
    metadata: payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? payload.metadata : {},
    payload: payload.payload,
    truncated: Boolean(payload.truncated),
    truncationReason: nullableString(payload.truncationReason)
  };
}

function authenticate(request, env) {
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

function normalizeStatus(value) {
  const status = value && typeof value === "object" ? value : {};
  return {
    taskId: nullableString(status.taskId),
    sessionName: nullableString(status.sessionName),
    status: nullableString(status.status) || "unknown",
    exitCode: nullableInteger(status.exitCode),
    startedAt: nullableString(status.startedAt),
    finishedAt: nullableString(status.finishedAt),
    logFile: nullableString(status.logFile)
  };
}

function normalizeSummary(value) {
  const summary = value && typeof value === "object" ? value : {};
  return {
    currentActivity: truncate(typeof summary.currentActivity === "string" ? summary.currentActivity : "", 500),
    completed: normalizeStringArray(summary.completed),
    remaining: normalizeStringArray(summary.remaining),
    blockers: normalizeStringArray(summary.blockers),
    isStuck: Boolean(summary.isStuck),
    progressPercent: nullableNumber(summary.progressPercent, 0, 100),
    progressConfidence: normalizeConfidence(summary.progressConfidence),
    etaMinutesMin: nullableNumber(summary.etaMinutesMin, 0),
    etaMinutesMax: nullableNumber(summary.etaMinutesMax, 0),
    etaConfidence: normalizeConfidence(summary.etaConfidence),
    goals: normalizeGoals(summary.goals),
    subgoals: normalizeSubgoals(summary.subgoals),
    cost: normalizeCost(summary.cost)
  };
}

function normalizeCost(value) {
  const cost = value && typeof value === "object" ? value : {};
  return {
    elapsedMinutes: nullableNumber(cost.elapsedMinutes, 0),
    digitalOceanHourlyUsd: nullableNumber(cost.digitalOceanHourlyUsd, 0),
    digitalOceanCostUsd: nullableNumber(cost.digitalOceanCostUsd, 0),
    digitalOceanConfidence: truncate(typeof cost.digitalOceanConfidence === "string" ? cost.digitalOceanConfidence : "unknown", 60),
    codexSubscriptionMonthlyUsd: nullableNumber(cost.codexSubscriptionMonthlyUsd, 0),
    codexSubscriptionSeatMultiplier: nullableNumber(cost.codexSubscriptionSeatMultiplier, 0) ?? 1,
    codexWeeklyBudgetUsd: nullableNumber(cost.codexWeeklyBudgetUsd, 0),
    codexSubscriptionMonthlyTokens: nullableNumber(cost.codexSubscriptionMonthlyTokens, 0),
    codexWeeklyTokenAllowance: nullableNumber(cost.codexWeeklyTokenAllowance, 0),
    codexObservedWeeklyTokens: nullableNumber(cost.codexObservedWeeklyTokens, 0),
    codexTaskAllocationUsd: nullableNumber(cost.codexTaskAllocationUsd, 0),
    codexTokenCostUsd: nullableNumber(cost.codexTokenCostUsd, 0),
    codexTaskAllocationPercent: nullableNumber(cost.codexTaskAllocationPercent, 0),
    codexRemainingWeeklyBudgetUsd: nullableNumber(cost.codexRemainingWeeklyBudgetUsd, 0),
    codexAllocationConfidence: truncate(typeof cost.codexAllocationConfidence === "string" ? cost.codexAllocationConfidence : "unknown", 60),
    codexAllocationSource: truncate(typeof cost.codexAllocationSource === "string" ? cost.codexAllocationSource : "unknown", 80),
    totalOperationalCostUsd: nullableNumber(cost.totalOperationalCostUsd, 0),
    totalEstimatedCostUsd: nullableNumber(cost.totalEstimatedCostUsd, 0),
    confidence: truncate(typeof cost.confidence === "string" ? cost.confidence : "unknown", 60),
    totalTokens: nullableNumber(cost.totalTokens, 0),
    inputTokens: nullableNumber(cost.inputTokens, 0),
    cachedInputTokens: nullableNumber(cost.cachedInputTokens, 0),
    outputTokens: nullableNumber(cost.outputTokens, 0),
    reasoningOutputTokens: nullableNumber(cost.reasoningOutputTokens, 0)
  };
}

function normalizeTelemetry(value, summary) {
  const telemetry = value && typeof value === "object" ? value : {};
  const events = normalizeEvents(telemetry.events);
  const files = normalizeFiles(telemetry.files);
  return {
    version: nullableInteger(telemetry.version) ?? 1,
    kind: ["live", "summary", "terminal"].includes(telemetry.kind) ? telemetry.kind : "summary",
    durableHistory: Boolean(telemetry.durableHistory),
    generatedAt: nullableString(telemetry.generatedAt),
    currentActivity: truncate(
      typeof telemetry.currentActivity === "string" ? telemetry.currentActivity : summary.currentActivity,
      500
    ),
    events,
    files,
    goals: normalizeGoals(telemetry.goals?.length ? telemetry.goals : summary.goals),
    subgoals: normalizeSubgoals(telemetry.subgoals?.length ? telemetry.subgoals : summary.subgoals),
    tokenUsage: normalizeTokenUsage(telemetry.tokenUsage || summary.cost),
    spend: normalizeCost(telemetry.spend || summary.cost),
    progress: {
      percent: nullableNumber(telemetry.progress?.percent ?? summary.progressPercent, 0, 100),
      confidence: normalizeConfidence(telemetry.progress?.confidence ?? summary.progressConfidence)
    },
    cursor:
      telemetry.cursor && typeof telemetry.cursor === "object"
        ? {
            logTailLineCount: nullableInteger(telemetry.cursor.logTailLineCount),
            logTailChars: nullableInteger(telemetry.cursor.logTailChars),
            lastEventId: nullableString(telemetry.cursor.lastEventId)
          }
        : null
  };
}

function normalizeEvents(value) {
  return Array.isArray(value)
    ? value
        .filter((event) => event && typeof event === "object")
        .slice(-300)
        .map((event) => ({
          id: truncate(nullableString(event.id) || stableId(JSON.stringify(event)), 100),
          timestamp: nullableString(event.timestamp),
          type: normalizeEventType(event.type),
          label: truncate(typeof event.label === "string" ? event.label : "Activity", 160),
          detail: truncate(typeof event.detail === "string" ? event.detail : "", 700),
          severity: normalizeSeverity(event.severity),
          status: nullableString(event.status),
          filePath: truncate(nullableString(event.filePath) || "", 500) || null,
          command:
            event.command && typeof event.command === "object"
              ? {
                  text: truncate(nullableString(event.command.text) || "", 700) || null,
                  exitCode: nullableInteger(event.command.exitCode)
                }
              : null,
          tool:
            event.tool && typeof event.tool === "object"
              ? {
                  name: truncate(nullableString(event.tool.name) || "", 120) || null
                }
              : null,
          inferred: Boolean(event.inferred),
          confidence: normalizeConfidence(event.confidence),
          source: truncate(nullableString(event.source) || "unknown", 120)
        }))
    : [];
}

function normalizeFiles(value) {
  return Array.isArray(value)
    ? value
        .filter((file) => file && typeof file === "object" && typeof file.path === "string")
        .slice(0, 200)
        .map((file) => ({
          path: truncate(file.path, 500),
          latestAction: ["read", "edited", "created", "deleted", "patched"].includes(file.latestAction)
            ? file.latestAction
            : "read",
          readCount: nullableInteger(file.readCount) ?? 0,
          editCount: nullableInteger(file.editCount) ?? 0,
          createCount: nullableInteger(file.createCount) ?? 0,
          deleteCount: nullableInteger(file.deleteCount) ?? 0,
          patchCount: nullableInteger(file.patchCount) ?? 0,
          lastSeenAt: nullableString(file.lastSeenAt),
          confidence: normalizeConfidence(file.confidence),
          source: truncate(nullableString(file.source) || "events", 120)
        }))
    : [];
}

function normalizeGoals(value) {
  return Array.isArray(value)
    ? value
        .filter((goal) => goal && typeof goal === "object" && typeof goal.label === "string")
        .slice(0, 16)
        .map((goal) => ({
          id: truncate(nullableString(goal.id) || stableId(goal.label), 100),
          label: truncate(goal.label, 180),
          state: normalizeGoalState(goal.state),
          confidence: normalizeConfidence(goal.confidence),
          source: truncate(nullableString(goal.source) || "summary", 120)
        }))
    : [];
}

function normalizeSubgoals(value) {
  return normalizeGoals(value).map((goal, index) => ({
    ...goal,
    parentId: Array.isArray(value) ? nullableString(value[index]?.parentId) : null
  }));
}

function normalizeTokenUsage(value) {
  const usage = value && typeof value === "object" ? value : {};
  return {
    inputTokens: nullableNumber(usage.inputTokens, 0) ?? 0,
    cachedInputTokens: nullableNumber(usage.cachedInputTokens, 0) ?? 0,
    outputTokens: nullableNumber(usage.outputTokens, 0) ?? 0,
    reasoningOutputTokens: nullableNumber(usage.reasoningOutputTokens, 0) ?? 0,
    totalTokens: nullableNumber(usage.totalTokens, 0) ?? 0
  };
}

function shouldStoreDurableHistory(payload, statusText) {
  if (!payload.telemetry) {
    return true;
  }
  const telemetry = payload.telemetry && typeof payload.telemetry === "object" ? payload.telemetry : {};
  return Boolean(telemetry.durableHistory) || telemetry.kind === "summary" || terminalStatuses.has(statusText);
}

function defaultStreamKind(sourceKind) {
  if (sourceKind === "runner-job") {
    return "runner-job";
  }
  if (sourceKind === "local-workspace" || sourceKind === "codespace-worker") {
    return "workspace";
  }
  return "codex-thread";
}

function sourceDatabaseId(envelope) {
  return `${envelope.sourceKind}:${envelope.sourceId}`.slice(0, 300);
}

function streamDatabaseId(envelope) {
  return `${envelope.streamKind}:${envelope.projectSlug}:${envelope.streamId}`.slice(0, 420);
}

function rawTelemetryKey(envelope, sha256) {
  const prefix = envelope.streamKind === "runner-job" ? "runner-job" : envelope.streamKind;
  const sequence = String(envelope.sequence).padStart(8, "0");
  return [
    "raw",
    "v1",
    prefix,
    safePathSegment(envelope.projectSlug),
    safePathSegment(envelope.streamId),
    `${sequence}-${sha256.slice(0, 16)}.json.gz`
  ].join("/");
}

function safePathSegment(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9._=-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160) || "unknown";
}

function statusHintFromEnvelope(envelope) {
  const metadata = envelope.metadata || {};
  const payload = envelope.payload || {};
  const candidates = [
    metadata.status,
    metadata.terminalStatus,
    payload.status?.status,
    payload.status,
    payload.thread?.status,
    payload.workspace?.status
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return truncate(candidate.trim(), 60);
    }
  }
  return envelope.streamKind === "runner-job" ? "running" : "active";
}

function titleFromEnvelope(envelope) {
  const metadata = envelope.metadata || {};
  const payload = envelope.payload || {};
  const candidates = [
    metadata.title,
    payload.title,
    payload.thread?.title,
    payload.workspace?.projectSlug,
    payload.prompt?.title,
    payload.prompt?.text
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return truncate(candidate.trim(), 180);
    }
  }
  return truncate(envelope.streamId, 180);
}

function activityFromEnvelope(envelope) {
  const metadata = envelope.metadata || {};
  const payload = envelope.payload || {};
  const candidates = [
    metadata.latestActivity,
    metadata.currentActivity,
    payload.latestActivity,
    payload.thread?.latestActivity,
    payload.summary?.currentActivity,
    payload.status?.status
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return truncate(candidate.trim(), 500);
    }
  }
  return null;
}

function tokenUsageFromEnvelope(envelope) {
  const metadata = envelope.metadata || {};
  const payload = envelope.payload || {};
  const usage =
    metadata.tokenUsage ||
    payload.tokenUsage ||
    payload.thread?.tokenUsage ||
    payload.codexJsonl?.tokenUsage ||
    payload.summary?.cost ||
    {};
  return normalizeTokenUsage(usage);
}

function linkedRunnerJobIdFromEnvelope(envelope) {
  const metadata = envelope.metadata || {};
  const payload = envelope.payload || {};
  const value = metadata.linkedRunnerJobId || payload.linkedRunnerJobId || payload.thread?.linkedRunnerJobId;
  return typeof value === "string" && value.trim() ? truncate(value.trim(), 240) : null;
}

function createdAtFromEnvelope(envelope) {
  const metadata = envelope.metadata || {};
  const payload = envelope.payload || {};
  const candidates = [
    metadata.createdAt,
    metadata.startedAt,
    payload.createdAt,
    payload.startedAt,
    payload.thread?.createdAt,
    payload.thread?.startedAt,
    payload.status?.startedAt
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return envelope.generatedAt;
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function gzipText(value) {
  const data = new TextEncoder().encode(value);
  if (typeof CompressionStream === "undefined") {
    return data;
  }
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(data);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeEventType(value) {
  return [
    "agent_message",
    "command_started",
    "command_finished",
    "file_read",
    "file_edited",
    "file_created",
    "file_deleted",
    "patch_applied",
    "tool_call",
    "error",
    "status_changed"
  ].includes(value)
    ? value
    : "tool_call";
}

function normalizeGoalState(value) {
  return ["not_started", "active", "complete", "blocked", "unknown"].includes(value) ? value : "unknown";
}

function normalizeSeverity(value) {
  return ["info", "success", "warning", "error"].includes(value) ? value : "info";
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => truncate(item, 500)).slice(0, 12) : [];
}

function normalizeConfidence(value) {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function nullableString(value) {
  return typeof value === "string" && value ? value : null;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function nullableNumber(value, min = -Infinity, max = Infinity) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(min, Math.min(max, numeric));
}

function truncate(value, max) {
  return value.length > max ? value.slice(0, max) : value;
}

function stableId(value) {
  let hash = 0x811c9dc5;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
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
