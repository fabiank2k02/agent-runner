import { processorStatus, runProcessor } from "../_shared/processor.js";

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ request, env }) {
  const auth = authenticateRead(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  const url = new URL(request.url);
  const projectSlug = url.searchParams.get("projectSlug") || env.AGENT_RUNNER_PROJECT_SLUG || "";
  try {
    return cors(json(await processorStatus({ env, projectSlug })));
  } catch (error) {
    return cors(json({ error: error instanceof Error ? error.message : String(error) }, 400));
  }
}

export async function onRequestPost({ request, env }) {
  const auth = authenticateToken(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return cors(json({ error: "Expected JSON body" }, 400));
  }
  const action = payload?.action || "process-once";
  const projectSlug = payload?.projectSlug || "";
  const ownerId = payload?.ownerId || ownerFromRequest(request);
  try {
    if (action === "status") {
      return cors(json(await processorStatus({ env, projectSlug })));
    }
    if (action === "rebuild") {
      return cors(
        json(
          await runProcessor({
            env,
            projectSlug,
            ownerId,
            mode: "rebuild",
            limits: payload?.limits || {},
            rebuild: payload?.scope || { project: true }
          })
        )
      );
    }
    if (action === "process-once" || action === "wake") {
      return cors(
        json(
          await runProcessor({
            env,
            projectSlug,
            ownerId,
            mode: "deterministic",
            limits: payload?.limits || {}
          })
        )
      );
    }
    return cors(json({ error: "Unsupported processor action" }, 400));
  } catch (error) {
    return cors(json({ error: error instanceof Error ? error.message : String(error) }, 500));
  }
}

function ownerFromRequest(request) {
  const url = new URL(request.url);
  return `dashboard-api:${url.hostname}`;
}

function authenticateRead(request, env) {
  if (request.headers.get("cf-access-jwt-assertion") || request.headers.get("cf-access-authenticated-user-email")) {
    return null;
  }
  return authenticateToken(request, env);
}

function authenticateToken(request, env) {
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
