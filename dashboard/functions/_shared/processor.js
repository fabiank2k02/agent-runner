import {
  aggregateAccountUsageRows,
  extractStreamTokenUsage
} from "./usage.js";

export const deterministicProcessorVersion = "deterministic-2026-06-17";

const terminalStatuses = new Set(["completed", "failed", "stopped"]);
const secretMarker = "[REDACTED_SECRET]";

const defaultLimits = {
  maxStreams: 20,
  maxChunks: 120,
  maxR2Bytes: 256 * 1024,
  maxRuntimeMs: 25_000,
  leaseSeconds: 90,
  maxModelPromptBytes: 0
};

export function normalizeProcessorLimits(input = {}) {
  return {
    maxStreams: boundedInteger(input.maxStreams, defaultLimits.maxStreams, 1, 100),
    maxChunks: boundedInteger(input.maxChunks, defaultLimits.maxChunks, 1, 1000),
    maxR2Bytes: boundedInteger(input.maxR2Bytes, defaultLimits.maxR2Bytes, 0, 5 * 1024 * 1024),
    maxRuntimeMs: boundedInteger(input.maxRuntimeMs, defaultLimits.maxRuntimeMs, 1000, 60_000),
    leaseSeconds: boundedInteger(input.leaseSeconds, defaultLimits.leaseSeconds, 15, 600),
    maxModelPromptBytes: boundedInteger(input.maxModelPromptBytes, defaultLimits.maxModelPromptBytes, 0, 1024 * 1024)
  };
}

export async function runProcessor({
  env,
  projectSlug,
  ownerId,
  mode = "deterministic",
  limits = {},
  rebuild = null,
  now = new Date()
}) {
  if (!env?.DB) {
    throw new Error("D1 binding DB is not configured");
  }
  const cleanProjectSlug = safeIdentifier(projectSlug || "");
  if (!cleanProjectSlug) {
    throw new Error("projectSlug is required");
  }
  const normalizedLimits = normalizeProcessorLimits(limits);
  const startedAt = now.toISOString();
  const runId = `run:${cleanProjectSlug}:${startedAt}:${stableId(ownerId || "processor")}`;
  const leaseId = `project:${cleanProjectSlug}:processor`;
  const cleanOwnerId = safeIdentifier(ownerId || `processor:${stableId(startedAt)}`).slice(0, 180);
  const errors = [];
  let stats = {
    chunksSeen: 0,
    chunksProcessed: 0,
    streamsUpdated: 0,
    memoriesUpdated: 0,
    r2BytesRead: 0,
    r2BytesSkipped: 0,
    chunksSkippedForBudget: 0
  };

  const lease = await acquireProcessingLease(env.DB, {
    leaseId,
    ownerId: cleanOwnerId,
    now,
    leaseSeconds: normalizedLimits.leaseSeconds,
    metadata: { mode, projectSlug: cleanProjectSlug }
  });
  if (!lease.acquired) {
    return {
      ok: false,
      status: "leased",
      projectSlug: cleanProjectSlug,
      runId,
      lease,
      limits: normalizedLimits
    };
  }

  await insertProcessingRun(env.DB, {
    id: runId,
    projectSlug: cleanProjectSlug,
    ownerId: cleanOwnerId,
    mode,
    status: "running",
    startedAt,
    metadata: {
      limits: normalizedLimits,
      deterministicVersion: deterministicProcessorVersion,
      model: {
        enabled: false,
        reason: "deterministic_default"
      },
      rebuild
    }
  });

  let status = "completed";
  try {
    if (rebuild) {
      await clearProcessedScope(env.DB, cleanProjectSlug, rebuild);
    }
    stats = await processAvailableStreams(env, {
      projectSlug: cleanProjectSlug,
      ownerId: cleanOwnerId,
      runId,
      limits: normalizedLimits,
      now,
      forceFromStart: Boolean(rebuild)
    });
  } catch (error) {
    status = "failed";
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const finishedAt = new Date().toISOString();
  await updateProcessingRun(env.DB, {
    id: runId,
    status,
    finishedAt,
    errors,
    stats,
    metadata: {
      limits: normalizedLimits,
      deterministicVersion: deterministicProcessorVersion,
      model: {
        enabled: false,
        reason: "deterministic_default"
      },
      rebuild
    }
  });
  await releaseProcessingLease(env.DB, { leaseId, ownerId: cleanOwnerId, now: new Date(), stats });

  return {
    ok: status === "completed",
    status,
    projectSlug: cleanProjectSlug,
    runId,
    leaseId,
    ownerId: cleanOwnerId,
    ...stats,
    errors,
    limits: normalizedLimits,
    deterministicVersion: deterministicProcessorVersion,
    model: {
      enabled: false,
      reason: "deterministic_default"
    }
  };
}

export async function acquireProcessingLease(db, { leaseId, ownerId, now = new Date(), leaseSeconds = 90, metadata = {} }) {
  const acquiredAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const existing = await db
    .prepare(`SELECT id, owner_id, acquired_at, expires_at, heartbeat_at, metadata_json FROM processing_leases WHERE id = ?`)
    .bind(leaseId)
    .first();

  if (!existing) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO processing_leases (
          id, owner_id, acquired_at, expires_at, heartbeat_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(leaseId, ownerId, acquiredAt, expiresAt, acquiredAt, JSON.stringify(metadata))
      .run();
  } else if (existing.owner_id === ownerId || Date.parse(existing.expires_at) <= now.getTime()) {
    await db
      .prepare(
        `UPDATE processing_leases
         SET owner_id = ?, acquired_at = ?, expires_at = ?, heartbeat_at = ?, metadata_json = ?
         WHERE id = ? AND (owner_id = ? OR expires_at <= ?)`
      )
      .bind(ownerId, acquiredAt, expiresAt, acquiredAt, JSON.stringify(metadata), leaseId, ownerId, acquiredAt)
      .run();
  }

  const current = await db
    .prepare(`SELECT id, owner_id, acquired_at, expires_at, heartbeat_at, metadata_json FROM processing_leases WHERE id = ?`)
    .bind(leaseId)
    .first();
  const acquired = Boolean(current && current.owner_id === ownerId && Date.parse(current.expires_at) > now.getTime());
  return {
    acquired,
    id: current?.id || leaseId,
    ownerId: current?.owner_id || null,
    acquiredAt: current?.acquired_at || null,
    expiresAt: current?.expires_at || null,
    heartbeatAt: current?.heartbeat_at || null,
    expired: current?.expires_at ? Date.parse(current.expires_at) <= now.getTime() : true,
    metadata: parseJson(current?.metadata_json, {})
  };
}

export async function renewProcessingLease(db, { leaseId, ownerId, now = new Date(), leaseSeconds = 90, metadata = {} }) {
  const heartbeatAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  await db
    .prepare(
      `UPDATE processing_leases
       SET expires_at = ?, heartbeat_at = ?, metadata_json = ?
       WHERE id = ? AND owner_id = ?`
    )
    .bind(expiresAt, heartbeatAt, JSON.stringify(metadata), leaseId, ownerId)
    .run();
  return db
    .prepare(`SELECT id, owner_id, acquired_at, expires_at, heartbeat_at, metadata_json FROM processing_leases WHERE id = ?`)
    .bind(leaseId)
    .first();
}

export async function releaseProcessingLease(db, { leaseId, ownerId, now = new Date(), stats = {} }) {
  const releasedAt = now.toISOString();
  await db
    .prepare(
      `UPDATE processing_leases
       SET expires_at = ?, heartbeat_at = ?, metadata_json = ?
       WHERE id = ? AND owner_id = ?`
    )
    .bind(releasedAt, releasedAt, JSON.stringify({ releasedAt, stats }), leaseId, ownerId)
    .run();
}

export async function processorStatus({ env, projectSlug, now = new Date() }) {
  if (!env?.DB) {
    throw new Error("D1 binding DB is not configured");
  }
  const cleanProjectSlug = safeIdentifier(projectSlug || "");
  if (!cleanProjectSlug) {
    throw new Error("projectSlug is required");
  }
  const leaseId = `project:${cleanProjectSlug}:processor`;
  const lease = await env.DB
    .prepare(`SELECT id, owner_id, acquired_at, expires_at, heartbeat_at, metadata_json FROM processing_leases WHERE id = ?`)
    .bind(leaseId)
    .first();
  const run = await env.DB
    .prepare(
      `SELECT id, project_slug, owner_id, mode, status, started_at, finished_at,
        chunks_seen, chunks_processed, streams_updated, memories_updated, errors_json, metadata_json
       FROM processing_runs
       WHERE project_slug = ?
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .bind(cleanProjectSlug)
    .first();
  const streams = await env.DB
    .prepare(
      `SELECT ts.id, ts.stream_kind, ts.stream_id, ts.updated_at,
        COALESCE(ps.processed_through_sequence, 0) AS processed_sequence,
        COALESCE(MAX(tc.sequence), 0) AS latest_sequence,
        ps.processed_at
       FROM telemetry_streams ts
       LEFT JOIN processed_streams ps ON ps.id = ts.id
       LEFT JOIN telemetry_chunks tc ON tc.stream_id = ts.id
       WHERE ts.project_slug = ?
       GROUP BY ts.id
       ORDER BY ts.updated_at DESC
       LIMIT 200`
    )
    .bind(cleanProjectSlug)
    .all();
  const usage = await latestAccountUsage(env.DB, cleanProjectSlug, env);
  const streamRows = streams.results || [];
  const pendingStreams = streamRows.filter((row) => Number(row.latest_sequence || 0) > Number(row.processed_sequence || 0));
  const latestRawSequence = streamRows.reduce((max, row) => Math.max(max, Number(row.latest_sequence || 0)), 0);
  const latestProcessedSequence = streamRows.reduce((max, row) => Math.max(max, Number(row.processed_sequence || 0)), 0);
  const runObject = run ? rowToObject(run) : null;
  const mappedRun = runObject ? mapRun(runObject) : null;
  const mappedLease = lease
    ? {
        id: lease.id,
        ownerId: lease.owner_id,
        acquiredAt: lease.acquired_at,
        expiresAt: lease.expires_at,
        heartbeatAt: lease.heartbeat_at,
        expired: Date.parse(lease.expires_at) <= now.getTime(),
        metadata: parseJson(lease.metadata_json, {})
      }
    : null;
  const warnings = budgetWarnings({ usage, lastRun: runObject });
  const cloudSummary = await projectCloudSummary(env.DB, cleanProjectSlug, now);
  const leaseStatus = mappedLease ? (mappedLease.expired ? "expired" : "active") : "none";
  const health = warnings.some((warning) => warning.severity === "error")
    ? "error"
    : warnings.length || pendingStreams.length
      ? "warning"
      : "healthy";

  return {
    projectSlug: cleanProjectSlug,
    automatic: {
      available: true,
      mode: "wake_on_ingest_or_local_loop",
      paused: false
    },
    lease: mappedLease,
    cursor: {
      streamCount: streamRows.length,
      pendingStreamCount: pendingStreams.length,
      latestRawSequence,
      latestProcessedSequence,
      behindBySequence: Math.max(0, latestRawSequence - latestProcessedSequence),
      pendingStreams: pendingStreams.slice(0, 20).map((row) => ({
        id: row.id,
        streamKind: row.stream_kind,
        streamId: row.stream_id,
        latestSequence: row.latest_sequence,
        processedSequence: row.processed_sequence,
        updatedAt: row.updated_at,
        processedAt: row.processed_at
      }))
    },
    runtime: {
      mode: "distributed",
      selectedProcessorInstance: mappedLease?.ownerId || mappedRun?.ownerId || null,
      leaseStatus,
      health,
      pendingStreams: pendingStreams.length,
      behindBySequence: Math.max(0, latestRawSequence - latestProcessedSequence),
      lastRunAt: mappedRun?.finishedAt || mappedRun?.startedAt || null,
      lastRunStatus: mappedRun?.status || null
    },
    lastRun: mappedRun,
    model: {
      enabled: false,
      mode: "deterministic-only",
      reason: "model_processing_not_configured"
    },
    cloudSummary,
    accountUsage: usage,
    warnings,
    deterministicVersion: deterministicProcessorVersion
  };
}

export async function processAvailableStreams(env, { projectSlug, ownerId, runId, limits, now, forceFromStart = false }) {
  const startedMs = Date.now();
  const rows = await env.DB
    .prepare(
      `SELECT ts.id, ts.source_id, ts.source_kind, ts.stream_kind, ts.stream_id, ts.project_slug,
        ts.task_id, ts.title, ts.status, ts.latest_activity, ts.created_at, ts.updated_at,
        ts.latest_telemetry_at, ts.latest_raw_telemetry_at, ts.terminal_at,
        ts.token_usage_json, ts.metadata_json, ts.linked_job_id,
        ps.status AS processed_status, ps.summary AS processed_summary,
        ps.latest_activity AS processed_latest_activity,
        ps.next_action AS processed_next_action,
        ps.blocker_json AS processed_blocker_json,
        ps.files_json AS processed_files_json,
        ps.token_usage_json AS processed_token_usage_json,
        ps.cost_json AS processed_cost_json,
        ps.linked_streams_json AS processed_linked_streams_json,
        ps.processed_through_sequence AS processed_through_sequence,
        ps.metadata_json AS processed_metadata_json
       FROM telemetry_streams ts
       LEFT JOIN processed_streams ps ON ps.id = ts.id
       WHERE ts.project_slug = ?
       ORDER BY ts.updated_at DESC
       LIMIT ?`
    )
    .bind(projectSlug, limits.maxStreams)
    .all();

  const stats = {
    chunksSeen: 0,
    chunksProcessed: 0,
    streamsUpdated: 0,
    memoriesUpdated: 0,
    r2BytesRead: 0,
    r2BytesSkipped: 0,
    chunksSkippedForBudget: 0
  };
  let remainingChunkBudget = limits.maxChunks;
  let remainingR2Bytes = limits.maxR2Bytes;

  for (const stream of rows.results || []) {
    if (Date.now() - startedMs > limits.maxRuntimeMs || remainingChunkBudget <= 0) {
      break;
    }
    const previousSequence = forceFromStart ? 0 : Number(stream.processed_through_sequence || 0);
    const chunks = await env.DB
      .prepare(
        `SELECT id, source_id, stream_id, source_kind, stream_kind, project_slug, task_id,
          sequence, r2_key, byte_size, uncompressed_byte_size, sha256, created_at,
          generated_at, cursor_json, metadata_json, terminal_status, payload_inline_json
         FROM telemetry_chunks
         WHERE stream_id = ? AND sequence > ?
         ORDER BY sequence ASC
         LIMIT ?`
      )
      .bind(stream.id, previousSequence, remainingChunkBudget)
      .all();

    const chunkRows = chunks.results || [];
    stats.chunksSeen += chunkRows.length;
    if (!chunkRows.length && stream.processed_through_sequence) {
      continue;
    }
    const aggregate = seedAggregate(stream, now, { includeStreamTokenUsage: chunkRows.length === 0 });
    for (const chunk of chunkRows) {
      if (Date.now() - startedMs > limits.maxRuntimeMs || remainingChunkBudget <= 0) {
        break;
      }
      remainingChunkBudget -= 1;
      const payloadResult = await readChunkEnvelope(env, chunk, remainingR2Bytes);
      if (payloadResult.r2BytesRead) {
        remainingR2Bytes -= payloadResult.r2BytesRead;
        stats.r2BytesRead += payloadResult.r2BytesRead;
      }
      if (payloadResult.r2BytesSkipped) {
        stats.r2BytesSkipped += payloadResult.r2BytesSkipped;
        stats.chunksSkippedForBudget += 1;
      }
      applyChunkToAggregate(aggregate, chunk, payloadResult.envelope);
      stats.chunksProcessed += 1;
    }

    const linkedStreams = await linkedStreamsFor(env.DB, stream);
    aggregate.linkedStreams = mergeLinkedStreams(aggregate.linkedStreams, linkedStreams);
    aggregate.metadata.processor = {
      runId,
      ownerId,
      deterministicVersion: deterministicProcessorVersion,
      chunksSeen: chunkRows.length,
      r2BytesRead: stats.r2BytesRead,
      r2BytesSkipped: stats.r2BytesSkipped,
      model: {
        enabled: false,
        reason: "deterministic_default"
      }
    };

    await upsertProcessedStream(env.DB, stream, aggregate, now.toISOString());
    stats.streamsUpdated += 1;
    for (const candidate of aggregate.memoryCandidates) {
      const updated = await upsertMemoryCandidate(env.DB, projectSlug, candidate, now.toISOString());
      if (updated) {
        stats.memoriesUpdated += 1;
      }
    }
  }

  stats.memoriesUpdated += await deriveRepeatedFileMemories(env.DB, projectSlug, now.toISOString());
  return stats;
}

export async function clearProcessedScope(db, projectSlug, scope = {}) {
  const streamId = scope.streamId ? safeIdentifier(scope.streamId) : "";
  const streamKind = scope.streamKind ? safeIdentifier(scope.streamKind) : "";
  if (streamId && streamKind) {
    const id = `${streamKind}:${projectSlug}:${streamId}`;
    await db.prepare(`DELETE FROM processed_streams WHERE project_slug = ? AND id = ?`).bind(projectSlug, id).run();
    return { scope: "stream", id };
  }
  await db.prepare(`DELETE FROM processed_streams WHERE project_slug = ?`).bind(projectSlug).run();
  await db
    .prepare(
      `UPDATE project_memory
       SET superseded_by = COALESCE(superseded_by, 'rebuild:' || ?), updated_at = ?
       WHERE project_slug = ? AND superseded_by IS NULL`
    )
    .bind(new Date().toISOString(), new Date().toISOString(), projectSlug)
    .run();
  return { scope: "project", projectSlug };
}

function seedAggregate(stream, now, options = {}) {
  const files = filesMapFromArray(parseJson(stream.processed_files_json, []));
  const blockers = parseJson(stream.processed_blocker_json, []);
  const metadata = parseJson(stream.processed_metadata_json, {});
  const processedTokenUsage = parseJson(stream.processed_token_usage_json, {});
  const includeStreamTokenUsage = options.includeStreamTokenUsage !== false;
  const tokenUsage = stream.processed_through_sequence || !includeStreamTokenUsage
    ? processedTokenUsage
    : addTokenUsage(processedTokenUsage, parseJson(stream.token_usage_json, {}));
  return {
    status: stream.processed_status || stream.status || "unknown",
    summary: stream.processed_summary || "",
    latestActivity: stream.processed_latest_activity || stream.latest_activity || "",
    nextAction: stream.processed_next_action || "",
    blockers: Array.isArray(blockers) ? blockers : [],
    files,
    tokenUsage,
    cost: parseJson(stream.processed_cost_json, {}),
    linkedStreams: parseJson(stream.processed_linked_streams_json, []),
    processedThroughSequence: Number(stream.processed_through_sequence || 0),
    latestGeneratedAt: stream.latest_raw_telemetry_at || stream.updated_at || now.toISOString(),
    promptSnippets: normalizeStringArray(metadata.promptSnippets).slice(-8),
    agentMessageSnippets: normalizeStringArray(metadata.agentMessageSnippets).slice(-12),
    commandActivity: Array.isArray(metadata.commandActivity) ? metadata.commandActivity.slice(-40) : [],
    toolActivity: Array.isArray(metadata.toolActivity) ? metadata.toolActivity.slice(-40) : [],
    memoryCandidates: [],
    metadata: {
      ...metadata,
      sourceTitle: stream.title || null,
      sourceMetadata: parseJson(stream.metadata_json, {}),
      rawFreshness: {
        latestRawTelemetryAt: stream.latest_raw_telemetry_at,
        processedAt: now.toISOString()
      }
    }
  };
}

function applyChunkToAggregate(aggregate, chunk, envelope) {
  const metadata = {
    ...parseJson(chunk.metadata_json, {}),
    ...(envelope?.metadata && typeof envelope.metadata === "object" ? envelope.metadata : {})
  };
  const payload = envelope?.payload && typeof envelope.payload === "object" ? envelope.payload : {};
  const timestamp = envelope?.generatedAt || chunk.generated_at || chunk.created_at;
  aggregate.processedThroughSequence = Math.max(aggregate.processedThroughSequence, Number(chunk.sequence || 0));
  aggregate.latestGeneratedAt = timestamp || aggregate.latestGeneratedAt;

  const status = firstString([
    chunk.terminal_status,
    metadata.status,
    metadata.terminalStatus,
    payload.status?.status,
    payload.status,
    payload.thread?.status,
    payload.workspace?.status,
    payload.telemetry?.status
  ]);
  if (status) {
    aggregate.status = terminalStatuses.has(status) || !terminalStatuses.has(aggregate.status) ? status : aggregate.status;
  }

  const latestActivity = firstString([
    metadata.latestActivity,
    metadata.currentActivity,
    payload.latestActivity,
    payload.currentActivity,
    payload.thread?.latestActivity,
    payload.summary?.currentActivity,
    payload.telemetry?.currentActivity,
    payload.status?.status
  ]);
  if (latestActivity) {
    aggregate.latestActivity = truncate(latestActivity, 500);
  }

  aggregate.tokenUsage = addTokenUsage(aggregate.tokenUsage, extractTokenUsage(metadata, payload));
  aggregate.cost = addCost(aggregate.cost, extractCost(payload));

  for (const file of extractFiles(payload, timestamp)) {
    mergeFile(aggregate.files, file);
  }
  for (const command of extractCommands(payload, timestamp)) {
    aggregate.commandActivity.push(command);
    if (command.failed) {
      addBlocker(aggregate, {
        kind: "failed_command",
        message: `Command failed: ${truncate(command.command || command.label || "unknown command", 220)}`,
        observedAt: timestamp,
        source: "deterministic",
        evidence: { chunkId: chunk.id, sequence: chunk.sequence }
      });
    }
  }
  for (const tool of extractTools(payload, timestamp)) {
    aggregate.toolActivity.push(tool);
  }
  for (const snippet of normalizeStringArray(payload.thread?.promptSnippets || payload.promptSnippets)) {
    aggregate.promptSnippets.push(truncate(snippet, 800));
  }
  for (const snippet of normalizeStringArray(payload.thread?.agentMessageSnippets || payload.agentMessageSnippets)) {
    aggregate.agentMessageSnippets.push(truncate(snippet, 800));
  }
  for (const line of normalizeStringArray(payload.codexJsonl?.lines).slice(-120)) {
    applyJsonlLine(aggregate, line, timestamp, chunk);
  }
  if (status === "failed" || chunk.terminal_status === "failed") {
    addBlocker(aggregate, {
      kind: "failed_status",
      message: "Stream reported failed status.",
      observedAt: timestamp,
      source: "deterministic",
      evidence: { chunkId: chunk.id, sequence: chunk.sequence }
    });
  }
  for (const event of normalizeArray(payload.telemetry?.events || payload.events)) {
    if (event?.type === "error" || event?.severity === "error") {
      addBlocker(aggregate, {
        kind: "error_event",
        message: truncate(firstString([event.detail, event.label, "Telemetry reported an error."]), 300),
        observedAt: firstString([event.timestamp, timestamp]),
        source: "deterministic",
        evidence: { chunkId: chunk.id, sequence: chunk.sequence, eventId: event.id || null }
      });
    }
  }
  for (const candidate of extractMemoryCandidates(payload, {
    streamId: chunk.stream_id,
    chunkId: chunk.id,
    sequence: chunk.sequence,
    timestamp,
    projectSlug: chunk.project_slug
  })) {
    aggregate.memoryCandidates.push(candidate);
  }

  aggregate.promptSnippets = uniqueStrings(aggregate.promptSnippets).slice(-8);
  aggregate.agentMessageSnippets = uniqueStrings(aggregate.agentMessageSnippets).slice(-12);
  aggregate.commandActivity = aggregate.commandActivity.slice(-40);
  aggregate.toolActivity = aggregate.toolActivity.slice(-40);
  aggregate.blockers = dedupeBlockers(aggregate.blockers).slice(-20);
  aggregate.summary = buildSummary(aggregate, chunk);
  aggregate.nextAction = nextActionForAggregate(aggregate, chunk);
}

async function readChunkEnvelope(env, chunk, remainingR2Bytes) {
  if (chunk.payload_inline_json) {
    return { envelope: parseJson(chunk.payload_inline_json, null), r2BytesRead: 0, r2BytesSkipped: 0 };
  }
  if (!chunk.r2_key) {
    return { envelope: null, r2BytesRead: 0, r2BytesSkipped: 0 };
  }
  const byteSize = Number(chunk.byte_size || 0);
  if (!env.RAW_TELEMETRY || byteSize > remainingR2Bytes) {
    return { envelope: null, r2BytesRead: 0, r2BytesSkipped: byteSize };
  }
  const object = await env.RAW_TELEMETRY.get(chunk.r2_key);
  if (!object) {
    return { envelope: null, r2BytesRead: 0, r2BytesSkipped: byteSize };
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const text = await decodeMaybeGzip(bytes);
  return { envelope: parseJson(text, null), r2BytesRead: byteSize || bytes.byteLength, r2BytesSkipped: 0 };
}

async function decodeMaybeGzip(bytes) {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (isGzip && typeof DecompressionStream !== "undefined") {
    const stream = new DecompressionStream("gzip");
    const writer = stream.writable.getWriter();
    await writer.write(bytes);
    await writer.close();
    return new TextDecoder().decode(await new Response(stream.readable).arrayBuffer());
  }
  return new TextDecoder().decode(bytes);
}

async function upsertProcessedStream(db, stream, aggregate, processedAt) {
  const files = Array.from(aggregate.files.values())
    .sort((left, right) => Date.parse(right.lastSeenAt || "") - Date.parse(left.lastSeenAt || ""))
    .slice(0, 160);
  const blockers = aggregate.blockers.slice(-20);
  const linkedStreams = normalizeArray(aggregate.linkedStreams).slice(0, 40);
  const summary = aggregate.summary || buildSummary(aggregate, null);
  await db
    .prepare(
      `INSERT INTO processed_streams (
        id, project_slug, stream_kind, stream_id, source_kind, status, summary,
        latest_activity, next_action, blocker_json, files_json, token_usage_json,
        cost_json, linked_streams_json, deterministic_version, model_version,
        prompt_hash, processed_through_sequence, processed_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_slug = excluded.project_slug,
        stream_kind = excluded.stream_kind,
        stream_id = excluded.stream_id,
        source_kind = excluded.source_kind,
        status = excluded.status,
        summary = excluded.summary,
        latest_activity = excluded.latest_activity,
        next_action = excluded.next_action,
        blocker_json = excluded.blocker_json,
        files_json = excluded.files_json,
        token_usage_json = excluded.token_usage_json,
        cost_json = excluded.cost_json,
        linked_streams_json = excluded.linked_streams_json,
        deterministic_version = excluded.deterministic_version,
        model_version = COALESCE(processed_streams.model_version, excluded.model_version),
        prompt_hash = excluded.prompt_hash,
        processed_through_sequence = excluded.processed_through_sequence,
        processed_at = excluded.processed_at,
        metadata_json = excluded.metadata_json`
    )
    .bind(
      stream.id,
      stream.project_slug,
      stream.stream_kind,
      stream.stream_id,
      stream.source_kind,
      truncate(aggregate.status || "unknown", 80),
      truncate(summary, 1500),
      truncate(aggregate.latestActivity || "", 500) || null,
      truncate(aggregate.nextAction || "", 500) || null,
      JSON.stringify(blockers),
      JSON.stringify(files),
      JSON.stringify(aggregate.tokenUsage),
      JSON.stringify(aggregate.cost),
      JSON.stringify(linkedStreams),
      deterministicProcessorVersion,
      null,
      aggregate.promptSnippets.length ? stableId(aggregate.promptSnippets.join("\n")) : null,
      aggregate.processedThroughSequence,
      processedAt,
      JSON.stringify({
        ...aggregate.metadata,
        promptSnippets: aggregate.promptSnippets,
        agentMessageSnippets: aggregate.agentMessageSnippets,
        commandActivity: aggregate.commandActivity,
        toolActivity: aggregate.toolActivity,
        fileCount: files.length,
        blockerCount: blockers.length,
        latestGeneratedAt: aggregate.latestGeneratedAt
      })
    )
    .run();
}

async function linkedStreamsFor(db, stream) {
  const links = [];
  if (stream.linked_job_id) {
    links.push({ id: stream.linked_job_id, relation: "linked-runner-job", observed: true });
  }
  if (stream.stream_kind === "runner-job") {
    const jobId = `${stream.project_slug}:${stream.stream_id}`;
    const result = await db
      .prepare(
        `SELECT id, source_kind, thread_id, title, updated_at
         FROM local_threads
         WHERE linked_runner_job_id = ?
         ORDER BY updated_at DESC
         LIMIT 20`
      )
      .bind(jobId)
      .all();
    for (const row of result.results || []) {
      links.push({
        id: row.id,
        relation: "local-thread-linked-to-job",
        sourceKind: row.source_kind,
        title: row.title || row.thread_id,
        updatedAt: row.updated_at,
        observed: true
      });
    }
  }
  return links;
}

function mergeLinkedStreams(left, right) {
  const seen = new Set();
  const merged = [];
  for (const item of [...normalizeArray(left), ...normalizeArray(right)]) {
    const id = item?.id || item?.streamId;
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(item);
  }
  return merged;
}

async function upsertMemoryCandidate(db, projectSlug, candidate, now) {
  const normalized = normalizeMemoryCandidate(candidate);
  if (!normalized) {
    return false;
  }
  const id = normalized.id || `memory:${projectSlug}:${safeSlug(normalized.memoryKind)}:${stableId(normalized.title)}`;
  const existing = await db
    .prepare(`SELECT id, evidence_json, created_at FROM project_memory WHERE id = ?`)
    .bind(id)
    .first();
  const evidence = mergeEvidence(parseJson(existing?.evidence_json, []), normalized.evidence);
  await db
    .prepare(
      `INSERT INTO project_memory (
        id, project_slug, memory_kind, title, body, evidence_strength,
        model_confidence, evidence_json, created_at, updated_at, superseded_by, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        body = excluded.body,
        evidence_strength = excluded.evidence_strength,
        model_confidence = excluded.model_confidence,
        evidence_json = excluded.evidence_json,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json`
    )
    .bind(
      id,
      projectSlug,
      normalized.memoryKind,
      normalized.title,
      normalized.body,
      normalized.evidenceStrength,
      normalized.modelConfidence,
      JSON.stringify(evidence),
      existing?.created_at || now,
      now,
      null,
      JSON.stringify(normalized.metadata)
    )
    .run();

  if (normalized.supersedesTitle) {
    await db
      .prepare(
        `UPDATE project_memory
         SET superseded_by = ?, updated_at = ?
         WHERE project_slug = ? AND lower(title) = lower(?) AND id <> ? AND superseded_by IS NULL`
      )
      .bind(id, now, projectSlug, normalized.supersedesTitle, id)
      .run();
  }
  return true;
}

async function deriveRepeatedFileMemories(db, projectSlug, now) {
  const rows = await db
    .prepare(
      `SELECT id, stream_kind, stream_id, files_json, processed_at
       FROM processed_streams
       WHERE project_slug = ?
       ORDER BY processed_at DESC
       LIMIT 200`
    )
    .bind(projectSlug)
    .all();
  const counts = new Map();
  for (const row of rows.results || []) {
    const files = parseJson(row.files_json, []);
    for (const file of files.slice(0, 80)) {
      if (!file?.path || deniedMemoryText(file.path)) {
        continue;
      }
      const entry = counts.get(file.path) || { path: file.path, streams: [] };
      if (!entry.streams.some((item) => item.streamId === row.id)) {
        entry.streams.push({ streamId: row.id, streamKind: row.stream_kind, streamLocalId: row.stream_id, timestamp: row.processed_at });
      }
      counts.set(file.path, entry);
    }
  }
  let updated = 0;
  for (const entry of Array.from(counts.values()).filter((item) => item.streams.length >= 2).slice(0, 5)) {
    const changed = await upsertMemoryCandidate(db, projectSlug, {
      memoryKind: "recurring_file",
      title: `Frequently touched file: ${entry.path}`,
      body: `${entry.path} appears in repeated telemetry activity across ${entry.streams.length} streams.`,
      evidenceStrength: entry.streams.length >= 4 ? "high" : "medium",
      evidence: entry.streams.slice(0, 8).map((stream) => ({
        sourceStreamId: stream.streamId,
        timestamp: stream.timestamp,
        evidenceStrength: entry.streams.length >= 4 ? "high" : "medium"
      })),
      metadata: { deterministic: true, source: "repeated_file_activity" }
    }, now);
    updated += changed ? 1 : 0;
  }
  return updated;
}

function extractMemoryCandidates(payload, evidenceBase) {
  const raw = normalizeArray(payload.projectMemory || payload.memoryCandidates || payload.memory);
  const candidates = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    candidates.push({
      memoryKind: item.memoryKind || item.kind || "fact",
      title: item.title,
      body: item.body || item.text,
      evidenceStrength: item.evidenceStrength || "medium",
      modelConfidence: item.modelConfidence || null,
      supersedesTitle: item.supersedesTitle || null,
      metadata: {
        deterministic: !item.modelConfidence,
        source: item.source || "payload"
      },
      evidence: [
        {
          sourceStreamId: evidenceBase.streamId,
          chunkId: evidenceBase.chunkId,
          sequence: evidenceBase.sequence,
          timestamp: evidenceBase.timestamp,
          evidenceStrength: item.evidenceStrength || "medium"
        }
      ]
    });
  }
  return candidates;
}

function normalizeMemoryCandidate(candidate) {
  const memoryKind = truncate(safeIdentifier(candidate.memoryKind || "fact"), 80) || "fact";
  const title = truncate(String(candidate.title || "").trim(), 180);
  const body = truncate(String(candidate.body || "").trim(), 2000);
  if (!title || !body || deniedMemoryText(title) || deniedMemoryText(body)) {
    return null;
  }
  const evidenceStrength = ["low", "medium", "high"].includes(candidate.evidenceStrength) ? candidate.evidenceStrength : "medium";
  const modelConfidence = ["low", "medium", "high"].includes(candidate.modelConfidence) ? candidate.modelConfidence : null;
  return {
    id: candidate.id ? truncate(String(candidate.id), 300) : null,
    memoryKind,
    title,
    body,
    evidenceStrength,
    modelConfidence,
    evidence: normalizeArray(candidate.evidence).slice(0, 20),
    supersedesTitle: candidate.supersedesTitle ? truncate(String(candidate.supersedesTitle), 180) : null,
    metadata: candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {}
  };
}

function deniedMemoryText(value) {
  const text = String(value || "");
  return (
    text.includes(secretMarker) ||
    /(^|\b)(api[_-]?key|token|password|private[_-]?key|auth\.json|\.env)(\b|$)/iu.test(text) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(text)
  );
}

function buildSummary(aggregate, chunk) {
  const kind = chunk?.stream_kind || "stream";
  const count = aggregate.processedThroughSequence;
  const files = aggregate.files.size;
  const blockers = aggregate.blockers.length;
  const tokens = aggregate.tokenUsage.totalTokens || 0;
  const activity = aggregate.latestActivity || "No recent activity extracted.";
  return [
    `${formatKind(kind)} is ${aggregate.status || "unknown"}.`,
    activity,
    `${count} raw chunks processed; ${files} files observed; ${tokens} tokens calculated.`,
    blockers ? `${blockers} blocker signals extracted.` : "No blocker signals extracted."
  ].join(" ");
}

function nextActionForAggregate(aggregate, chunk) {
  if (aggregate.blockers.length) {
    return `Inspect blocker: ${aggregate.blockers.at(-1).message}`;
  }
  if (aggregate.status === "completed") {
    return "Review the completed work and sync or close the job when ready.";
  }
  if (aggregate.status === "failed") {
    return "Open the latest logs and decide whether to retry or repair the failed command.";
  }
  if (chunk?.stream_kind === "workspace" && aggregate.files.size) {
    return "Review the observed workspace changes and decide what to commit or sync.";
  }
  return "Continue monitoring for new raw telemetry.";
}

function extractTokenUsage(metadata, payload) {
  return extractStreamTokenUsage(metadata, payload);
}

function addTokenUsage(left = {}, right = {}) {
  const result = { ...left };
  for (const key of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"]) {
    result[key] = finiteNumber(result[key]) + finiteNumber(right?.[key] ?? snakeValue(right, key));
  }
  if (!result.totalTokens) {
    result.totalTokens = finiteNumber(result.inputTokens) + finiteNumber(result.outputTokens);
  }
  return result;
}

function extractCost(payload) {
  return payload?.telemetry?.spend || payload?.summary?.cost || payload?.cost || {};
}

function addCost(left = {}, right = {}) {
  const result = { ...left };
  for (const [key, value] of Object.entries(right || {})) {
    if (key === "confidence" || key === "digitalOceanConfidence" || key === "codexAllocationConfidence") {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = finiteNumber(result[key]) + value;
    } else if (result[key] === undefined && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function extractFiles(payload, timestamp) {
  const files = [];
  for (const file of normalizeArray(payload?.thread?.files)) {
    pushFile(files, file, "observed", timestamp, "thread");
  }
  for (const file of normalizeArray(payload?.workspace?.dirtyFiles)) {
    pushFile(files, file, "changed", timestamp, "workspace");
  }
  for (const file of normalizeArray(payload?.telemetry?.files || payload?.files)) {
    pushFile(files, file, file.latestAction || "observed", file.lastSeenAt || timestamp, file.source || "telemetry");
  }
  for (const event of normalizeArray(payload?.telemetry?.events || payload?.events)) {
    if (event?.filePath) {
      pushFile(files, { path: event.filePath }, actionForEvent(event.type), event.timestamp || timestamp, event.source || "event");
    }
  }
  return files.filter((file) => file.path && !deniedMemoryText(file.path));
}

function pushFile(files, value, action, timestamp, source) {
  if (typeof value === "string") {
    files.push({ path: truncate(value, 500), latestAction: action, count: 1, lastSeenAt: timestamp, source });
  } else if (value && typeof value === "object") {
    const path = value.path || value.filePath || value.name;
    if (typeof path === "string" && path) {
      files.push({
        path: truncate(path, 500),
        latestAction: value.latestAction || value.status || action,
        count: 1,
        readCount: finiteNumber(value.readCount),
        editCount: finiteNumber(value.editCount),
        createCount: finiteNumber(value.createCount),
        deleteCount: finiteNumber(value.deleteCount),
        patchCount: finiteNumber(value.patchCount),
        lastSeenAt: value.lastSeenAt || timestamp,
        source
      });
    }
  }
}

function mergeFile(files, file) {
  const existing = files.get(file.path) || {
    path: file.path,
    latestAction: file.latestAction || "observed",
    count: 0,
    readCount: 0,
    editCount: 0,
    createCount: 0,
    deleteCount: 0,
    patchCount: 0,
    lastSeenAt: file.lastSeenAt,
    source: file.source || "deterministic"
  };
  existing.count += file.count || 1;
  existing.latestAction = file.latestAction || existing.latestAction;
  existing.lastSeenAt = file.lastSeenAt || existing.lastSeenAt;
  existing.readCount += finiteNumber(file.readCount);
  existing.editCount += finiteNumber(file.editCount);
  existing.createCount += finiteNumber(file.createCount);
  existing.deleteCount += finiteNumber(file.deleteCount);
  existing.patchCount += finiteNumber(file.patchCount);
  files.set(file.path, existing);
}

function extractCommands(payload, timestamp) {
  const commands = [];
  for (const command of normalizeArray(payload?.thread?.commandEvents || payload?.commandEvents)) {
    if (typeof command === "string") {
      commands.push({ command: truncate(command, 700), timestamp, failed: false, source: "thread" });
    } else if (command && typeof command === "object") {
      commands.push({
        command: truncate(command.command || command.text || "", 700),
        label: truncate(command.label || "", 160),
        timestamp: command.timestamp || timestamp,
        status: command.status || null,
        exitCode: command.exitCode ?? command.command?.exitCode ?? null,
        failed: command.status === "failed" || Number(command.exitCode ?? command.command?.exitCode ?? 0) > 0,
        source: command.source || "thread"
      });
    }
  }
  for (const event of normalizeArray(payload?.telemetry?.events || payload?.events)) {
    if (event?.command?.text || event?.type === "command_started" || event?.type === "command_finished") {
      commands.push({
        command: truncate(event.command?.text || event.detail || event.label || "", 700),
        label: truncate(event.label || "", 160),
        timestamp: event.timestamp || timestamp,
        exitCode: event.command?.exitCode ?? null,
        failed: event.severity === "error" || Number(event.command?.exitCode ?? 0) > 0,
        source: event.source || "event"
      });
    }
  }
  return commands.filter((command) => command.command || command.label).slice(-80);
}

function extractTools(payload, timestamp) {
  const tools = [];
  for (const event of normalizeArray(payload?.telemetry?.events || payload?.events)) {
    if (event?.tool?.name || event?.type === "tool_call") {
      tools.push({
        name: truncate(event.tool?.name || event.label || "tool", 120),
        timestamp: event.timestamp || timestamp,
        source: event.source || "event"
      });
    }
  }
  return tools;
}

function applyJsonlLine(aggregate, line, timestamp, chunk) {
  const event = parseJson(line, null);
  if (!event || typeof event !== "object") {
    return;
  }
  const item = event.item && typeof event.item === "object" ? event.item : {};
  const eventTimestamp = event.timestamp || timestamp;
  const text = typeof item.text === "string" ? item.text : typeof event.text === "string" ? event.text : "";
  if (item.type === "user_message" || event.type === "user_message") {
    aggregate.promptSnippets.push(truncate(text, 800));
  }
  if (item.type === "agent_message" || event.type === "agent_message") {
    aggregate.agentMessageSnippets.push(truncate(text, 800));
    aggregate.latestActivity = truncate(text, 500) || aggregate.latestActivity;
  }
  if (typeof item.command === "string" || item.type === "command_execution") {
    aggregate.commandActivity.push({
      command: truncate(item.command || "", 700),
      timestamp: eventTimestamp,
      status: item.status || null,
      failed: item.status === "failed" || Number(item.exit_code ?? item.exitCode ?? 0) > 0,
      source: "codex_jsonl"
    });
  }
  if (String(event.type || "").includes("error")) {
    addBlocker(aggregate, {
      kind: "error_event",
      message: truncate(text || "Codex JSONL reported an error.", 300),
      observedAt: eventTimestamp,
      source: "deterministic",
      evidence: { chunkId: chunk.id, sequence: chunk.sequence }
    });
  }
  aggregate.tokenUsage = addTokenUsage(aggregate.tokenUsage, event.usage || event.response?.usage || {});
}

function addBlocker(aggregate, blocker) {
  aggregate.blockers.push(blocker);
}

function dedupeBlockers(blockers) {
  const seen = new Set();
  const result = [];
  for (const blocker of blockers) {
    const key = `${blocker.kind}:${blocker.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(blocker);
  }
  return result;
}

function filesMapFromArray(files) {
  const map = new Map();
  for (const file of normalizeArray(files)) {
    if (file?.path) {
      map.set(file.path, file);
    }
  }
  return map;
}

function actionForEvent(type) {
  if (type === "file_read") return "read";
  if (type === "file_edited") return "edited";
  if (type === "file_created") return "created";
  if (type === "file_deleted") return "deleted";
  if (type === "patch_applied") return "patched";
  return "observed";
}

async function insertProcessingRun(db, run) {
  await db
    .prepare(
      `INSERT INTO processing_runs (
        id, project_slug, owner_id, mode, status, started_at, finished_at,
        chunks_seen, chunks_processed, streams_updated, memories_updated, errors_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      run.id,
      run.projectSlug,
      run.ownerId,
      run.mode,
      run.status,
      run.startedAt,
      null,
      0,
      0,
      0,
      0,
      "[]",
      JSON.stringify(run.metadata || {})
    )
    .run();
}

async function updateProcessingRun(db, { id, status, finishedAt, errors, stats, metadata }) {
  await db
    .prepare(
      `UPDATE processing_runs
       SET status = ?, finished_at = ?, chunks_seen = ?, chunks_processed = ?,
         streams_updated = ?, memories_updated = ?, errors_json = ?, metadata_json = ?
       WHERE id = ?`
    )
    .bind(
      status,
      finishedAt,
      stats.chunksSeen,
      stats.chunksProcessed,
      stats.streamsUpdated,
      stats.memoriesUpdated,
      JSON.stringify(errors),
      JSON.stringify({ ...metadata, stats }),
      id
    )
    .run();
}

async function latestAccountUsage(db, projectSlug, env = {}) {
  const rows = await db
    .prepare(
      `SELECT id, source_id, collected_at, weekly_remaining_json, rolling_5h_remaining_json,
        token_usage_json, reset_json, metadata_json
       FROM account_usage_snapshots
       WHERE project_slug = ?
       ORDER BY collected_at DESC
       LIMIT 50`
    )
    .bind(projectSlug)
    .all();
  return aggregateAccountUsageRows(rows.results || [], { env });
}

async function projectCloudSummary(db, projectSlug, now = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const storage = await db
    .prepare(
      `SELECT
        COUNT(*) AS chunk_count,
        COALESCE(SUM(byte_size), 0) AS byte_size,
        COALESCE(SUM(CASE WHEN r2_key IS NOT NULL AND r2_key != '' THEN byte_size ELSE 0 END), 0) AS r2_byte_size,
        COALESCE(SUM(CASE WHEN r2_key IS NOT NULL AND r2_key != '' THEN 1 ELSE 0 END), 0) AS r2_object_count
       FROM telemetry_chunks
       WHERE project_slug = ?`
    )
    .bind(projectSlug)
    .first();
  const running = await db
    .prepare(
      `SELECT remote_host, COUNT(*) AS count
       FROM jobs
       WHERE project_slug = ? AND status = 'running'
       GROUP BY remote_host
       ORDER BY count DESC
       LIMIT 20`
    )
    .bind(projectSlug)
    .all();
  const costs = await db
    .prepare(
      `SELECT cost_json, processed_at
       FROM processed_streams
       WHERE project_slug = ? AND processed_at >= ?
       ORDER BY processed_at DESC
       LIMIT 200`
    )
    .bind(projectSlug, startOfDay.toISOString())
    .all();

  let estimatedCostTodayUsd = null;
  let costSourceCount = 0;
  for (const row of costs.results || []) {
    const cost = parseJson(row.cost_json, {});
    const value = nullableNumber(
      cost.totalOperationalCostUsd ??
        cost.totalEstimatedCostUsd ??
        cost.digitalOceanCostUsd ??
        cost.codexCostUsd ??
        cost.codexTaskAllocationUsd
    );
    if (value !== null) {
      estimatedCostTodayUsd = (estimatedCostTodayUsd || 0) + value;
      costSourceCount += 1;
    }
  }

  const runningRows = running.results || [];
  const runningJobCount = runningRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const hosts = runningRows.map((row) => row.remote_host).filter(Boolean);
  const byteSize = Number(storage?.byte_size || 0);
  const r2ByteSize = Number(storage?.r2_byte_size || 0);

  return {
    rawTelemetryStorage: {
      available: true,
      method: "d1_chunk_metadata_estimate",
      byteSize,
      r2ByteSize,
      inlineByteSize: Math.max(0, byteSize - r2ByteSize),
      chunkCount: Number(storage?.chunk_count || 0),
      r2ObjectCount: Number(storage?.r2_object_count || 0),
      reason: "Estimated from telemetry chunk metadata stored in D1."
    },
    snapshotStorage: {
      available: false,
      method: "unavailable",
      byteSize: null,
      reason: "Snapshot storage telemetry is not collected by this dashboard."
    },
    runningPods: {
      available: true,
      method: "derived_from_running_jobs",
      count: runningJobCount,
      hostCount: hosts.length,
      hosts,
      reason: runningJobCount ? "Derived from running dashboard jobs and remote hosts." : "No running jobs are currently reported."
    },
    estimatedCostToday: {
      available: costSourceCount > 0,
      method: costSourceCount > 0 ? "processed_job_cost_estimate" : "unavailable",
      usd: estimatedCostTodayUsd,
      sourceCount: costSourceCount,
      reason: costSourceCount > 0
        ? "Summed from processed stream cost telemetry for jobs processed today."
        : "No processed cost telemetry is available for today."
    }
  };
}

function budgetWarnings({ usage, lastRun }) {
  const warnings = [];
  const weeklyPercent = nullableNumber(usage?.weekly?.percentRemaining ?? usage?.latest?.weeklyRemaining?.percentRemaining);
  if (weeklyPercent !== null && weeklyPercent < 15) {
    warnings.push({
      kind: "codex_weekly_limit_low",
      severity: weeklyPercent < 5 ? "error" : "warning",
      message: `Observed weekly Codex limit is low (${weeklyPercent.toFixed(1)}% remaining).`
    });
  }
  const rollingPercent = nullableNumber(usage?.rolling5h?.percentRemaining ?? usage?.latest?.rolling5hRemaining?.percentRemaining);
  if (rollingPercent !== null && rollingPercent < 15) {
    warnings.push({
      kind: "codex_5h_limit_low",
      severity: rollingPercent < 5 ? "error" : "warning",
      message: `Observed rolling 5-hour Codex limit is low (${rollingPercent.toFixed(1)}% remaining).`
    });
  }
  const metadata = parseJson(lastRun?.metadata_json, {});
  const stats = metadata.stats || {};
  if (finiteNumber(stats.r2BytesSkipped) > 0) {
    warnings.push({
      kind: "r2_read_budget_reached",
      severity: "warning",
      message: "Processor skipped some R2 payload reads because the per-run byte budget was reached."
    });
  }
  return warnings;
}

function mapRun(row) {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    ownerId: row.owner_id,
    mode: row.mode,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    chunksSeen: row.chunks_seen || 0,
    chunksProcessed: row.chunks_processed || 0,
    streamsUpdated: row.streams_updated || 0,
    memoriesUpdated: row.memories_updated || 0,
    errors: parseJson(row.errors_json, []),
    metadata: parseJson(row.metadata_json, {})
  };
}

function rowToObject(row) {
  return row || {};
}

function boundedInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function snakeValue(object, camelKey) {
  const snake = camelKey.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  return object?.[snake];
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function mergeEvidence(existing, incoming) {
  const seen = new Set();
  const result = [];
  for (const item of [...normalizeArray(existing), ...normalizeArray(incoming)]) {
    const key = `${item.sourceStreamId || ""}:${item.chunkId || ""}:${item.sequence || ""}:${item.timestamp || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result.slice(-40);
}

function safeIdentifier(value) {
  return String(value || "").trim().replace(/[^\w:./@=-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function safeSlug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "item";
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

function formatKind(value) {
  return String(value || "stream").replace(/-/gu, " ");
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}
