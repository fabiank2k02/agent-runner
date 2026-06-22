import { json } from "../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  if (!hasCloudflareAccessIdentity(request)) {
    return json({ error: "Cloudflare Access identity required" }, 401);
  }

  const token = env.AGENT_RUNNER_DASHBOARD_TOKEN || env.AGENT_RUNNER_DASHBOARD_PREVIEW_TOKEN;
  if (!token) {
    return json({ error: "Dashboard API token is not configured" }, 500);
  }

  return json({
    ok: true,
    token,
    identity: {
      email: request.headers.get("cf-access-authenticated-user-email") || null
    }
  });
}

function hasCloudflareAccessIdentity(request) {
  return Boolean(request.headers.get("cf-access-jwt-assertion") || request.headers.get("cf-access-authenticated-user-email"));
}
