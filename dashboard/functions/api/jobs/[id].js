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
      eta_minutes_min, eta_minutes_max, eta_confidence, summary_json, status_json, telemetry_json, log_file, log_tail
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

  return cors(json({ job: mapJobRow(job), history: (history.results || []).map(mapSummaryRow) }));
}

function authenticateRead(request, env) {
  if (request.headers.get("cf-access-jwt-assertion") || request.headers.get("cf-access-authenticated-user-email")) {
    return null;
  }
  if (hasCloudflareAccessSession(request)) {
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

function hasCloudflareAccessSession(request) {
  const cookie = request.headers.get("cookie") || "";
  return /(?:^|;\s*)CF_Authorization=/.test(cookie) || /(?:^|;\s*)CF_AppSession=/.test(cookie);
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
    logTail: row.log_tail
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
