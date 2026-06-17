const MAX_LOG_TAIL_CHARS = 100000;
const terminalStatuses = new Set(["completed", "failed", "stopped"]);

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
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

  const validation = validatePayload(payload);
  if (validation.error) {
    return cors(json({ error: validation.error }, 400));
  }

  const now = new Date().toISOString();
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
