const tokenKey = "agent-runner-dashboard-token";
let sessionToken = "";
let sessionTokenPromise = null;

export async function fetchDashboardData() {
  const [jobsResponse, activityResponse, processedResponse] = await Promise.all([
    api("/api/jobs?limit=12"),
    api("/api/activity").catch(() => ({ activity: [] })),
    api("/api/processed-streams").catch(() => ({ streams: [] }))
  ]);

  const jobs = Array.isArray(jobsResponse.jobs) ? jobsResponse.jobs : [];
  const selected = preferredJob(jobs);
  const projectSlug = selected?.projectSlug || jobs[0]?.projectSlug || processedResponse.streams?.[0]?.projectSlug || "agent-runner";

  const [processorStatus, detailResponse] = await Promise.all([
    api(`/api/processor?projectSlug=${encodeURIComponent(projectSlug)}`).catch((error) => ({
      projectSlug,
      error: error.message || String(error)
    })),
    selected ? api(`/api/jobs/${encodeURIComponent(selected.id)}`).catch(() => null) : Promise.resolve(null)
  ]);

  return {
    jobs,
    selectedJobDetail: detailResponse?.job || null,
    activity: Array.isArray(activityResponse.activity) ? activityResponse.activity : [],
    processedStreams: Array.isArray(processedResponse.streams) ? processedResponse.streams : [],
    processorStatus,
    loadedAt: new Date().toISOString()
  };
}

async function api(path, options = {}) {
  const retryAuth = options.retryAuth !== false;
  const headers = { accept: "application/json" };
  const storedToken = localStorage.getItem(tokenKey);
  let token = sessionToken;
  let tokenSource = token ? "session" : "";

  if (!token) {
    const loaded = await loadAccessSessionToken();
    if (loaded) {
      token = sessionToken;
      tokenSource = "session";
    }
  }

  if (tokenSource === "session" && storedToken && storedToken !== token) {
    localStorage.removeItem(tokenKey);
  }

  if (!token && storedToken) {
    token = storedToken;
    tokenSource = "stored";
  }

  if (!token) {
    throw new Error("Dashboard auth required");
  }
  headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, { headers });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : {};
  if (retryAuth && tokenSource === "stored" && shouldRetryWithAccessSession(response, contentType)) {
    localStorage.removeItem(tokenKey);
    sessionToken = "";
    const loaded = await loadAccessSessionToken({ force: true });
    if (loaded) {
      return api(path, { retryAuth: false });
    }
  }
  if (!response.ok) {
    throw new Error(data.error || response.statusText || "Dashboard request failed");
  }
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON from ${path}`);
  }
  return data;
}

async function loadAccessSessionToken(options = {}) {
  if (options.force) {
    sessionToken = "";
    sessionTokenPromise = null;
  }
  if (sessionToken) return true;
  if (!sessionTokenPromise) {
    sessionTokenPromise = fetch("/session/token", { headers: { accept: "application/json" } })
      .then(async (response) => {
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("application/json")) return false;
        const data = await response.json().catch(() => ({}));
        if (data?.token) {
          sessionToken = data.token;
          return true;
        }
        return false;
      })
      .catch(() => false)
      .finally(() => {
        sessionTokenPromise = null;
      });
  }
  return sessionTokenPromise;
}

function shouldRetryWithAccessSession(response, contentType) {
  return response.status === 401 || response.status === 403 || !contentType.includes("application/json");
}

function preferredJob(jobs) {
  return jobs.find((job) => job.status === "running" && !job.isStuck) ||
    jobs.find((job) => !["completed", "failed", "stopped", "timed-out"].includes(job.status)) ||
    jobs[0] ||
    null;
}
