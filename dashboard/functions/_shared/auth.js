export function authenticateApiRequest(request, env, options = {}) {
  const allowAccessIdentity = options.allowAccessIdentity === true || env.AGENT_RUNNER_ALLOW_CF_ACCESS_IDENTITY_AUTH === "true";
  if (allowAccessIdentity && hasCloudflareAccessIdentity(request)) {
    return null;
  }
  if (hasDashboardToken(request, env) || hasConfiguredAccessServiceToken(request, env)) {
    return null;
  }
  if (!hasAnyConfiguredAuth(env)) {
    return { status: 500, body: { error: "Dashboard API auth is not configured" } };
  }
  return { status: 401, body: { error: "Unauthorized" } };
}

export function cors(response, methods = "GET,POST,OPTIONS") {
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-methods", methods);
  response.headers.set(
    "access-control-allow-headers",
    "authorization,content-type,x-agent-runner-token,cf-access-client-id,cf-access-client-secret"
  );
  return response;
}

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function hasDashboardToken(request, env) {
  const expected = env.AGENT_RUNNER_DASHBOARD_TOKEN || env.AGENT_RUNNER_DASHBOARD_PREVIEW_TOKEN;
  if (!expected) {
    return false;
  }
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : request.headers.get("x-agent-runner-token") || "";
  return token === expected;
}

function hasConfiguredAccessServiceToken(request, env) {
  const expectedId =
    env.AGENT_RUNNER_CF_ACCESS_CLIENT_ID ||
    env.CF_ACCESS_CLIENT_ID ||
    env.CLOUDFLARE_ACCESS_CLIENT_ID;
  const expectedSecret =
    env.AGENT_RUNNER_CF_ACCESS_CLIENT_SECRET ||
    env.CF_ACCESS_CLIENT_SECRET ||
    env.CLOUDFLARE_ACCESS_CLIENT_SECRET;
  if (!expectedId || !expectedSecret) {
    return false;
  }
  return (
    request.headers.get("cf-access-client-id") === expectedId &&
    request.headers.get("cf-access-client-secret") === expectedSecret
  );
}

function hasAnyConfiguredAuth(env) {
  return Boolean(
    env.AGENT_RUNNER_DASHBOARD_TOKEN ||
      env.AGENT_RUNNER_DASHBOARD_PREVIEW_TOKEN ||
      ((env.AGENT_RUNNER_CF_ACCESS_CLIENT_ID || env.CF_ACCESS_CLIENT_ID || env.CLOUDFLARE_ACCESS_CLIENT_ID) &&
        (env.AGENT_RUNNER_CF_ACCESS_CLIENT_SECRET || env.CF_ACCESS_CLIENT_SECRET || env.CLOUDFLARE_ACCESS_CLIENT_SECRET))
  );
}

function hasCloudflareAccessIdentity(request) {
  return Boolean(request.headers.get("cf-access-jwt-assertion") || request.headers.get("cf-access-authenticated-user-email"));
}
