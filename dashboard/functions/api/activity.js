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
  const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "40", 10)));
  const jobs = await env.DB.prepare(
    `SELECT id, project_slug, task_id, status, updated_at, current_activity,
      last_raw_telemetry_at, raw_chunk_count
     FROM jobs
     ORDER BY updated_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();
  const threads = await env.DB.prepare(
    `SELECT id, source_kind, project_slug, thread_id, title, status,
      latest_activity, updated_at, latest_raw_telemetry_at, raw_chunk_count
     FROM local_threads
     ORDER BY updated_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  const items = [
    ...(jobs.results || []).map((job) => ({
      type: "runner-job",
      label: "Runner job",
      id: job.id,
      projectSlug: job.project_slug,
      title: job.task_id,
      status: job.status,
      activity: job.current_activity,
      updatedAt: job.updated_at,
      latestRawTelemetryAt: job.last_raw_telemetry_at,
      rawChunkCount: job.raw_chunk_count || 0
    })),
    ...(threads.results || []).map((thread) => ({
      type: thread.source_kind === "codex-ide-thread" ? "ide-thread" : thread.source_kind === "local-workspace" ? "workspace" : "cli-thread",
      label: thread.source_kind === "codex-ide-thread" ? "IDE thread" : thread.source_kind === "local-workspace" ? "Workspace telemetry" : "CLI thread",
      id: thread.id,
      projectSlug: thread.project_slug,
      title: thread.title || thread.thread_id,
      status: thread.status,
      activity: thread.latest_activity,
      updatedAt: thread.updated_at,
      latestRawTelemetryAt: thread.latest_raw_telemetry_at,
      rawChunkCount: thread.raw_chunk_count || 0
    }))
  ]
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""))
    .slice(0, limit);

  return cors(json({ activity: items }));
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
