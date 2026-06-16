const MAX_LOG_TAIL_CHARS = 100000;
const MAX_SUMMARIES_PER_JOB = 100;

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
      summary_json, status_json, log_file, log_tail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      nullableString(payload.logFile),
      logTail
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO summaries (job_id, received_at, generated_at, summary_json, status_json, log_tail)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(jobId, now, generatedAt, JSON.stringify(summary), JSON.stringify(status), logTail)
    .run();

  await env.DB.prepare(
    `DELETE FROM summaries
     WHERE job_id = ?
       AND id NOT IN (
         SELECT id FROM summaries WHERE job_id = ? ORDER BY received_at DESC LIMIT ?
       )`
  )
    .bind(jobId, jobId, MAX_SUMMARIES_PER_JOB)
    .run();

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
    cost: normalizeCost(summary.cost)
  };
}

function normalizeCost(value) {
  const cost = value && typeof value === "object" ? value : {};
  return {
    elapsedMinutes: nullableNumber(cost.elapsedMinutes, 0),
    digitalOceanHourlyUsd: nullableNumber(cost.digitalOceanHourlyUsd, 0),
    digitalOceanCostUsd: nullableNumber(cost.digitalOceanCostUsd, 0),
    codexSubscriptionMonthlyUsd: nullableNumber(cost.codexSubscriptionMonthlyUsd, 0),
    codexSubscriptionMonthlyTokens: nullableNumber(cost.codexSubscriptionMonthlyTokens, 0),
    codexTokenCostUsd: nullableNumber(cost.codexTokenCostUsd, 0),
    totalEstimatedCostUsd: nullableNumber(cost.totalEstimatedCostUsd, 0),
    totalTokens: nullableNumber(cost.totalTokens, 0),
    inputTokens: nullableNumber(cost.inputTokens, 0),
    cachedInputTokens: nullableNumber(cost.cachedInputTokens, 0),
    outputTokens: nullableNumber(cost.outputTokens, 0),
    reasoningOutputTokens: nullableNumber(cost.reasoningOutputTokens, 0)
  };
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
