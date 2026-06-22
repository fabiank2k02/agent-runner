import { authenticateApiRequest, cors, json } from "../_shared/auth.js";
import { processorStatus, runProcessor } from "../_shared/processor.js";

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ request, env }) {
  const auth = authenticateApiRequest(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  const url = new URL(request.url);
  const projectSlug = url.searchParams.get("projectSlug") || env.AGENT_RUNNER_PROJECT_SLUG || "agent-runner";
  try {
    return cors(json(await processorStatus({ env, projectSlug })));
  } catch (error) {
    return cors(json({ error: error instanceof Error ? error.message : String(error) }, 400));
  }
}

export async function onRequestPost({ request, env }) {
  const auth = authenticateApiRequest(request, env);
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
  const projectSlug = payload?.projectSlug || env.AGENT_RUNNER_PROJECT_SLUG || "agent-runner";
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
