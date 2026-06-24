const tokenKey = "agent-runner-dashboard-token";
const routes = [
  { id: "now", label: "Now" },
  { id: "code", label: "Code" },
  { id: "jobs", label: "Jobs" },
  { id: "cloud", label: "Cloud" },
  { id: "review", label: "Review" },
  { id: "usage", label: "Usage" }
];
const terminalStatuses = new Set(["completed", "failed", "stopped"]);
let suppressNextHashChange = false;
let sessionTokenLoadPromise = null;

const state = {
  route: routeFromHash(),
  previousRoute: routeFromHash(),
  token: localStorage.getItem(tokenKey) || "",
  sessionToken: "",
  jobs: [],
  activity: [],
  processedStreams: [],
  processorStatus: null,
  selectedJobId: null,
  detailJob: null,
  detailHistory: [],
  detailRawChunks: [],
  detailError: null,
  loading: false,
  error: null,
  lastUpdatedAt: null
};

const app = document.querySelector("#app");

app.addEventListener("click", (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    setRoute(routeButton.dataset.route);
    return;
  }

  const refreshButton = event.target.closest("[data-refresh]");
  if (refreshButton) {
    loadDashboard();
    return;
  }

  const jobButton = event.target.closest("[data-job-id]");
  if (jobButton) {
    selectJob(jobButton.dataset.jobId);
  }
});

app.addEventListener("submit", (event) => {
  if (event.target.matches("[data-disabled-composer]")) {
    event.preventDefault();
  }
});

window.addEventListener("hashchange", () => {
  const nextRoute = routeFromHash();
  if (suppressNextHashChange && nextRoute === state.route) {
    suppressNextHashChange = false;
    return;
  }
  suppressNextHashChange = false;
  state.previousRoute = state.route;
  state.route = nextRoute;
  render();
});

setInterval(() => {
  if (!state.loading) {
    loadDashboard({ quiet: true });
  }
}, 15000);

render();
loadDashboard();

function routeFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  return routes.some((route) => route.id === raw) ? raw : "now";
}

function setRoute(route) {
  if (!routes.some((item) => item.id === route)) {
    route = "now";
  }
  if (state.route === route) {
    render();
    return;
  }
  state.previousRoute = state.route;
  state.route = route;
  suppressNextHashChange = true;
  window.location.hash = route;
  render();
}

async function loadDashboard(options = {}) {
  state.loading = true;
  state.error = null;
  if (!options.quiet) {
    render();
  }

  try {
    const [jobsResponse, activityResponse, processedResponse] = await Promise.all([
      api("/api/jobs?limit=12"),
      api("/api/activity").catch(() => ({ activity: [] })),
      api("/api/processed-streams").catch(() => ({ streams: [] }))
    ]);
    state.jobs = Array.isArray(jobsResponse.jobs) ? jobsResponse.jobs : [];
    state.activity = Array.isArray(activityResponse.activity) ? activityResponse.activity : [];
    state.processedStreams = Array.isArray(processedResponse.streams) ? processedResponse.streams : [];
    if (!state.jobs.some((job) => job.id === state.selectedJobId)) {
      state.selectedJobId = preferredJob(state.jobs)?.id || null;
      state.detailJob = null;
      state.detailHistory = [];
      state.detailRawChunks = [];
    }

    const projectSlug = currentProjectSlug();
    state.processorStatus = await api("/api/processor?projectSlug=" + encodeURIComponent(projectSlug)).catch((error) => ({
      projectSlug,
      error: error.message || String(error)
    }));

    if (state.selectedJobId) {
      await loadSelectedDetail(state.selectedJobId);
    }
    state.lastUpdatedAt = new Date();
  } catch (error) {
    state.error = error;
  } finally {
    state.loading = false;
    render();
  }
}

async function loadSelectedDetail(id) {
  state.detailError = null;
  try {
    const data = await api("/api/jobs/" + encodeURIComponent(id));
    state.detailJob = data.job || null;
    state.detailHistory = Array.isArray(data.history) ? data.history : [];
    state.detailRawChunks = Array.isArray(data.rawChunks) ? data.rawChunks : [];
  } catch (error) {
    state.detailError = error;
    state.detailJob = null;
    state.detailHistory = [];
    state.detailRawChunks = [];
  }
}

async function selectJob(id) {
  if (!id || state.selectedJobId === id) {
    return;
  }
  state.selectedJobId = id;
  state.detailJob = null;
  state.detailHistory = [];
  state.detailRawChunks = [];
  state.detailError = null;
  render();
  await loadSelectedDetail(id);
  render();
}

async function api(path, options = {}) {
  const retryAuth = options.retryAuth !== false;
  const headers = { accept: "application/json" };
  const token = state.token || state.sessionToken;
  if (!token) {
    const loaded = await loadAccessSessionToken();
    if (loaded) {
      return api(path);
    }
    throw new Error("Dashboard auth required");
  }
  if (token) {
    headers.authorization = "Bearer " + token;
  }
  const response = await fetch(path, { headers });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : {};
  if (retryAuth && shouldRefreshAccessToken(response, contentType)) {
    if (state.token) {
      localStorage.removeItem(tokenKey);
      state.token = "";
    }
    state.sessionToken = "";
    const loaded = await loadAccessSessionToken({ force: true });
    if (loaded) {
      return api(path, { retryAuth: false });
    }
  }
  if (!response.ok) {
    throw new Error(data.error || response.statusText || "Dashboard request failed");
  }
  if (!contentType.includes("application/json")) {
    throw new Error("Expected JSON from " + path);
  }
  return data;
}

function shouldRefreshAccessToken(response, contentType) {
  return response.status === 401 || response.status === 403 || !contentType.includes("application/json");
}

async function loadAccessSessionToken(options = {}) {
  if (options.force) {
    state.sessionToken = "";
    sessionTokenLoadPromise = null;
  }
  if (state.sessionToken) {
    return true;
  }
  if (sessionTokenLoadPromise) {
    return sessionTokenLoadPromise;
  }
  sessionTokenLoadPromise = loadAccessSessionTokenOnce();
  try {
    return await sessionTokenLoadPromise;
  } finally {
    sessionTokenLoadPromise = null;
  }
}

async function loadAccessSessionTokenOnce() {
  try {
    const response = await fetch("/session/token", { headers: { accept: "application/json" } });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      return false;
    }
    const data = await response.json().catch(() => ({}));
    if (data?.token) {
      state.sessionToken = data.token;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function render() {
  const selected = selectedJob();
  const activeIndex = Math.max(0, routes.findIndex((route) => route.id === state.route));
  const activeLeft = (activeIndex * 100) / routes.length;
  const activeCenter = ((activeIndex + 0.5) * 100) / routes.length;
  ensureShell();
  const main = app.querySelector(".page");
  main.className = `page page-${state.route}`;
  main.innerHTML = `
    <div class="page-status">
      <span class="access-pill"><i></i>Access protected</span>
      <span>${escapeHtml(freshnessText())}</span>
      <button class="refresh-control ${state.loading ? "is-loading" : ""}" type="button" data-refresh ${state.loading ? "disabled" : ""}>
        <span></span>Refresh
      </button>
    </div>
    ${state.error ? alertBanner("Dashboard data unavailable", state.error.message || String(state.error)) : ""}
    ${state.route === "now" ? renderNowPage(selected) : ""}
    ${state.route === "jobs" ? renderJobsPage(selected) : ""}
    ${["code", "cloud", "review", "usage"].includes(state.route) ? renderPlaceholderPage() : ""}
  `;
  renderNav(activeIndex, activeLeft, activeCenter);
  state.previousRoute = state.route;
}

function ensureShell() {
  if (app.querySelector(".global-header")) {
    return;
  }
  app.innerHTML = `
    <div class="ambient-grid" aria-hidden="true"></div>
    <header class="global-header">
      <a class="brand" href="#now" aria-label="Agent Runner Now">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span class="brand-name">Agent Runner</span>
      </a>
      <nav class="liquid-nav" aria-label="Primary" style="--tab-count:${routes.length}">
        <span class="nav-wedge" aria-hidden="true"></span>
        ${routes.map((route) => navTab(route)).join("")}
      </nav>
      <div class="utility-cluster">
        <button class="icon-button search-icon" type="button" aria-label="Search" disabled></button>
        <button class="icon-button bell-icon" type="button" aria-label="Notifications" disabled></button>
        <span class="profile-chip" aria-label="Profile"><span>AR</span><i></i></span>
      </div>
    </header>
    <main class="page"></main>
  `;
}

function renderNav(activeIndex, activeLeft, activeCenter) {
  const nav = app.querySelector(".liquid-nav");
  if (!nav) {
    return;
  }
  nav.style.setProperty("--active-index", String(activeIndex));
  nav.style.setProperty("--active-left", `${activeLeft}%`);
  nav.style.setProperty("--active-center", `${activeCenter}%`);
  nav.style.setProperty("--tab-count", String(routes.length));
  const wedge = nav.querySelector(".nav-wedge");
  if (wedge) {
    const navBox = nav.getBoundingClientRect();
    const currentBox = wedge.getBoundingClientRect();
    const currentLeft = currentBox.left - navBox.left;
    const tabWidth = navBox.width / routes.length;
    const edgeOffset = window.matchMedia("(max-width: 720px)").matches ? 7 : 12;
    const nextLeft = activeIndex * tabWidth - edgeOffset;
    const delta = currentLeft - nextLeft;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (wedge._navAnimationTimer) {
      clearTimeout(wedge._navAnimationTimer);
      wedge._navAnimationTimer = null;
    }
    wedge.style.left = `${nextLeft}px`;
    if (!reducedMotion && Math.abs(delta) > 1) {
      const duration = 360;
      const startedAt = performance.now();
      const tick = () => {
        const progress = clamp((performance.now() - startedAt) / duration, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const offset = delta * (1 - eased);
        wedge.style.transform = `translateX(${offset}px)`;
        if (progress < 1) {
          wedge._navAnimationTimer = setTimeout(tick, 16);
        } else {
          wedge.style.transform = "";
          wedge._navAnimationTimer = null;
        }
      };
      wedge.style.transform = `translateX(${delta}px)`;
      wedge._navAnimationTimer = setTimeout(tick, 16);
    } else {
      wedge.style.transform = "";
    }
  }
  for (const button of nav.querySelectorAll("[data-route]")) {
    const active = button.dataset.route === state.route;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  }
}

function navTab(route) {
  const active = route.id === state.route;
  return `
    <button class="nav-tab ${active ? "active" : ""}" type="button" data-route="${escapeAttribute(route.id)}" aria-current="${active ? "page" : "false"}">
      <span>${escapeHtml(route.label)}</span>
    </button>
  `;
}

function renderNowPage(job) {
  if (state.loading && !state.jobs.length) {
    return skeletonNow();
  }
  if (!state.jobs.length) {
    return `
      <section class="now-layout empty-now-layout">
        ${emptyPanel("No active jobs", "Runner jobs will appear here after ingest. Live values remain unavailable until production telemetry arrives.")}
      </section>
      ${renderInstrumentRow(null)}
    `;
  }

  const jobs = carouselJobs(job);
  const previous = jobs.previous;
  const next = jobs.next;
  return `
    <div class="now-stage">
      ${previous ? renderCarouselArrow(previous, "previous") : ""}
      <section class="now-layout">
        ${previous ? renderSideJobCard(previous, "previous") : `<div class="side-job-card side-job-placeholder">${emptyMini("No previous job")}</div>`}
        ${renderSelectedNowCard(job)}
        ${next ? renderSideJobCard(next, "next") : `<div class="side-job-card side-job-placeholder">${emptyMini("No next job")}</div>`}
      </section>
      ${next ? renderCarouselArrow(next, "next") : ""}
    </div>
    <div class="carousel-dots" aria-label="Job carousel position">
      ${state.jobs.slice(0, 7).map((item) => `
        <button type="button" data-job-id="${escapeAttribute(item.id)}" class="${item.id === job?.id ? "active" : ""}" aria-label="${escapeAttribute(jobTitle(item))}"></button>
      `).join("")}
    </div>
    ${renderInstrumentRow(job)}
  `;
}

function renderCarouselArrow(job, direction) {
  return `
    <button class="carousel-arrow ${escapeAttribute(direction)}" type="button" data-job-id="${escapeAttribute(job.id)}" aria-label="${direction === "previous" ? "Previous" : "Next"} job: ${escapeAttribute(jobTitle(job))}">
      <span aria-hidden="true"></span>
    </button>
  `;
}

function renderSelectedNowCard(job) {
  const status = displayStatus(job);
  const percent = completionPercent(job);
  const goals = jobGoals(job);
  const subgoals = jobSubgoals(job);
  const current = currentSubgoal(job);
  const remaining = remainingGoals(job);
  return `
    <article class="selected-job-card glass-panel status-${escapeAttribute(statusClass(status))}">
      <div class="job-card-topline">
        <span class="live-dot"></span>
        <span>${escapeHtml(status === "running" ? "Active job" : "Selected job")}</span>
        <span class="job-id">Job ID: ${escapeHtml(shortId(job?.id))}</span>
        ${statusChip(status)}
      </div>
      <div class="job-title-row">
        <div>
          <h1>${escapeHtml(jobTitle(job))}</h1>
          <p class="job-branch"><span class="branch-icon"></span>${escapeHtml(jobBranch(job))}</p>
        </div>
        <button class="review-button" type="button" disabled>Review</button>
      </div>
      <div class="stat-grid now-stats">
        ${statCell("Elapsed", elapsedText(job), "clock")}
        ${statCell("ETA", etaText(job), "hourglass")}
        ${statCell("Total completion", percent === null ? "Pending" : formatPercent(percent), "progress")}
        ${statCell("Remaining", remaining === null ? "No data" : `${remaining} ${remaining === 1 ? "goal" : "goals"}`, "list")}
      </div>
      <section class="current-strip">
        <div>
          <span>Current subgoal</span>
          <strong>${escapeHtml(current.label)}</strong>
        </div>
        <div class="pulse-line" aria-hidden="true"><i></i></div>
        <span class="eta-note">ETA ${escapeHtml(etaText(job, { short: true }))}</span>
      </section>
      <div class="selected-job-body">
        <div class="completion-readout">
          ${progressArc(percent)}
          <strong>${escapeHtml(percent === null ? "Pending" : formatPercent(percent))}</strong>
          <span>Total completion</span>
        </div>
        <section class="goal-board">
          <div class="panel-head">
            <h2>Contract goals</h2>
            <span>${escapeHtml(goals.length ? `${remaining ?? 0} remaining` : "Unavailable")}</span>
          </div>
          ${renderGoalRows(goals, subgoals, { limit: 5 })}
        </section>
      </div>
    </article>
  `;
}

function renderSideJobCard(job, position) {
  const percent = completionPercent(job);
  const remaining = remainingGoals(job);
  const goals = jobGoals(job);
  return `
    <button class="side-job-card glass-panel ${escapeAttribute(position)} status-${escapeAttribute(statusClass(displayStatus(job)))}" type="button" data-job-id="${escapeAttribute(job.id)}" aria-label="Select ${escapeAttribute(jobTitle(job))}">
      <div class="mini-job-head">
        <span class="job-icon ${escapeAttribute(jobIconClass(job))}"></span>
        <div>
          <strong>${escapeHtml(jobTitle(job))}</strong>
          <span>${escapeHtml(jobBranch(job))}</span>
        </div>
        ${statusChip(displayStatus(job))}
      </div>
      <div class="mini-stat-grid">
        ${miniStat("Elapsed", elapsedText(job))}
        ${miniStat("ETA", etaText(job, { short: true }))}
        ${miniStat("Total", percent === null ? "Pending" : formatPercent(percent))}
        ${miniStat("Remaining", remaining === null ? "No data" : `${remaining} goals`)}
      </div>
      <div class="mini-goals">
        <span>Contract goals</span>
        ${goals.length ? renderGoalRows(goals, jobSubgoals(job), { limit: 2, compact: true }) : emptyMini("Goals unavailable")}
      </div>
      ${thinProgress(percent)}
    </button>
  `;
}

function renderInstrumentRow(job) {
  return `
    <section class="instrument-row">
      ${usageInstrument(job)}
      ${cloudInstrument()}
      ${processorInstrument()}
    </section>
  `;
}

function usageInstrument(job) {
  const usage = state.processorStatus?.accountUsage;
  const weekly = usage?.weekly || usage?.latest?.weeklyRemaining || null;
  const percent = numberOrNull(weekly?.percentRemaining);
  const burn = usage?.burn || {};
  const cost = jobCost(job);
  const costValue = numberOrNull(cost?.codexTaskAllocationUsd ?? cost?.codexCostUsd ?? cost?.totalOperationalCostUsd ?? cost?.totalEstimatedCostUsd);
  return `
    <article class="instrument glass-panel">
      <div class="panel-head">
        <h2>Usage</h2>
        <span>${escapeHtml(usage?.label || "Unavailable")}</span>
      </div>
      <div class="usage-instrument-grid">
        <div class="allowance-meter">
          ${progressArc(percent)}
          <strong>${escapeHtml(percent === null ? "No data" : formatPercent(percent))}</strong>
          <span>Codex allowance</span>
          <small>${escapeHtml(formatLimitTokens(weekly))}</small>
        </div>
        <div class="token-pulse ${burn.lastHour?.tokens ? "" : "is-unavailable"}">
          <span>Token pulse</span>
          <div class="sparkline" aria-hidden="true"><i></i></div>
          <strong>${escapeHtml(formatTokenBurn(burn.lastHour))}</strong>
          <small>${escapeHtml(burn.lastHour?.tokens ? "last hour" : "No data yet")}</small>
        </div>
        <div class="cost-cell">
          <span>Selected job cost</span>
          <strong>${escapeHtml(formatUsd(costValue))}</strong>
          <small>${escapeHtml(costValue === null ? "Unavailable" : formatUsageMethod(cost?.codexCostMethod || cost?.tokenUsageMethod))}</small>
        </div>
      </div>
    </article>
  `;
}

function cloudInstrument() {
  const cloud = state.processorStatus?.cloudSummary;
  const storage = cloud?.rawTelemetryStorage;
  const snapshots = cloud?.snapshotStorage;
  const runningPods = cloud?.runningPods;
  const costToday = cloud?.estimatedCostToday;
  return `
    <article class="instrument glass-panel">
      <div class="panel-head">
        <h2>Cloud costs</h2>
        <span>${escapeHtml(cloud ? "Job telemetry" : "Unavailable")}</span>
      </div>
      <div class="cloud-grid">
        ${cloudCell("R2 storage", storage ? formatBytes(storage.r2ByteSize) : "No data", storage?.method || "unavailable")}
        ${cloudCell("Snapshots", snapshots?.available ? formatBytes(snapshots.byteSize) : "No data", snapshots?.method || "unavailable")}
        ${cloudCell("Running pods", runningPods ? String(runningPods.count) : "No data", runningPods?.method || "unavailable")}
        ${cloudCell("Est. today", costToday?.available ? formatUsd(costToday.usd) : "No data", costToday?.method || "unavailable")}
      </div>
      <div class="instrument-foot">
        <span>Total telemetry bytes</span>
        <strong>${escapeHtml(storage ? formatBytes(storage.byteSize) : "No data")}</strong>
      </div>
    </article>
  `;
}

function processorInstrument() {
  const status = state.processorStatus;
  const runtime = status?.runtime || {};
  const cursor = status?.cursor || {};
  const health = runtime.health || (status?.error ? "error" : "unavailable");
  return `
    <article class="instrument glass-panel">
      <div class="panel-head">
        <h2>Processor</h2>
        <span>${escapeHtml(runtime.mode || "Unavailable")}</span>
      </div>
      <div class="processor-select">
        <span class="job-icon cube"></span>
        <div>
          <span>Processor</span>
          <strong>${escapeHtml(runtime.selectedProcessorInstance || "No active lease")}</strong>
        </div>
      </div>
      <div class="processor-grid">
        ${processorMetric("Health", formatStatus(health), health)}
        ${processorMetric("Lease", formatStatus(runtime.leaseStatus || "No data"), runtime.leaseStatus)}
        ${processorMetric("Pending streams", cursor.pendingStreamCount ?? "No data")}
        ${processorMetric("Behind", cursor.behindBySequence ?? "No data")}
        ${processorMetric("Last run", formatRelative(runtime.lastRunAt), runtime.lastRunStatus)}
      </div>
    </article>
  `;
}

function renderJobsPage(job) {
  if (state.loading && !state.jobs.length) {
    return skeletonJobs();
  }
  if (!state.jobs.length) {
    return `
      <section class="jobs-page empty-jobs-page">
        ${emptyPanel("No jobs yet", "The work surface will populate after runner ingest creates jobs.")}
      </section>
    `;
  }
  return `
    <section class="jobs-page">
      <aside class="jobs-selector glass-panel">
        <div class="selector-head">
          <div>
            <h1>Jobs</h1>
            <span>${escapeHtml(`${state.jobs.length} total`)}</span>
          </div>
          <span class="auto-refresh"><i></i>Auto refresh 15s</span>
        </div>
        ${renderSelectorGroup("Active", state.jobs.filter((item) => !terminalStatuses.has(item.status)).slice(0, 6), job)}
        ${renderSelectorGroup("Recent", state.jobs.filter((item) => terminalStatuses.has(item.status)).slice(0, 6), job)}
      </aside>
      <div class="job-work-column">
        ${renderJobWorkSurface(job)}
        ${renderCostOverview(job)}
      </div>
      <aside class="job-right-rail">
        ${renderCurrentGoalPanel(job)}
        ${renderContractGoalsPanel(job)}
        ${renderProcessorPanel()}
        ${renderJobContextPanel(job)}
        ${renderJobHealthPanel(job)}
      </aside>
    </section>
  `;
}

function renderSelectorGroup(title, jobs, selected) {
  return `
    <section class="selector-group">
      <h2>${escapeHtml(title)}</h2>
      ${jobs.length ? jobs.map((job) => renderJobSelectorCard(job, selected?.id === job.id)).join("") : emptyMini(`No ${title.toLowerCase()} jobs`)}
    </section>
  `;
}

function renderJobSelectorCard(job, active) {
  const percent = completionPercent(job);
  const remaining = remainingGoals(job);
  return `
    <button class="selector-job ${active ? "active" : ""} status-${escapeAttribute(statusClass(displayStatus(job)))}" type="button" data-job-id="${escapeAttribute(job.id)}">
      <div class="selector-title">
        <span class="job-icon ${escapeAttribute(jobIconClass(job))}"></span>
        <div>
          <strong>${escapeHtml(jobTitle(job))}</strong>
          <span>${escapeHtml(jobBranch(job))}</span>
        </div>
        ${statusChip(displayStatus(job))}
      </div>
      ${thinProgress(percent)}
      <div class="selector-meta">
        <span>${escapeHtml(elapsedText(job))} elapsed</span>
        <span>${escapeHtml(etaText(job, { short: true }))}</span>
        <span>${escapeHtml(remaining === null ? "Goals unavailable" : `${remaining} goals`)}</span>
      </div>
    </button>
  `;
}

function renderJobWorkSurface(job) {
  const status = displayStatus(job);
  const percent = completionPercent(job);
  const remaining = remainingGoals(job);
  const current = currentSubgoal(job);
  const cost = jobCost(job);
  return `
    <article class="work-surface glass-panel status-${escapeAttribute(statusClass(status))}">
      <div class="work-head">
        <div>
          <div class="headline-kicker"><span class="live-dot"></span>${escapeHtml(formatStatus(status))}</div>
          <h1>${escapeHtml(jobTitle(job))} <small>${escapeHtml(jobBranch(job))}</small></h1>
        </div>
        <div class="job-id-copy">Job ID: ${escapeHtml(shortId(job?.id))}</div>
      </div>
      <div class="stat-grid work-stats">
        ${statCell("Elapsed", elapsedText(job), "clock")}
        ${statCell("ETA", etaText(job), "hourglass")}
        ${statCell("Completion", percent === null ? "Pending" : formatPercent(percent), "progress")}
        ${statCell("Remaining", remaining === null ? "No data" : `${remaining} goals`, "list")}
        ${statCell("Token burn", formatTokenRate(job, cost), "bolt")}
        ${statCell("Est. cost", formatUsd(cost?.totalOperationalCostUsd ?? cost?.totalEstimatedCostUsd ?? cost?.codexCostUsd), "dollar")}
      </div>
      <section class="current-strip work-current">
        <div>
          <span>Current subgoal</span>
          <strong>${escapeHtml(current.label)}</strong>
        </div>
        <div class="pulse-line" aria-hidden="true"><i></i></div>
        <span class="eta-note">ETA ${escapeHtml(etaText(job, { short: true }))}</span>
      </section>
      ${renderWorkStream(job)}
    </article>
  `;
}

function renderWorkStream(job) {
  const stream = workStream(job);
  return `
    <section class="stream-panel">
      <div class="panel-head">
        <h2>Live work stream</h2>
        <span>${escapeHtml(stream.semantic ? "Live events" : "Preview stream")}</span>
      </div>
      ${!stream.semantic ? `<p class="stream-disclaimer">Skeleton from selected job metadata. Semantic log parsing is not complete yet.</p>` : ""}
      <div class="stream-list">
        ${stream.events.slice(0, 3).map(streamEventRow).join("")}
      </div>
      <form class="disabled-composer" data-disabled-composer>
        <input type="text" placeholder="Ask about this job..." disabled aria-disabled="true">
        <button type="submit" disabled aria-label="Ask disabled"><span></span></button>
      </form>
    </section>
  `;
}

function streamEventRow(event) {
  return `
    <article class="stream-event ${escapeAttribute(event.tone || "info")}">
      <span class="stream-node ${escapeAttribute(event.icon || "search")}"></span>
      <time>${escapeHtml(event.time || "Pending")}</time>
      <div>
        <div class="stream-event-title">
          <strong>${escapeHtml(event.title)}</strong>
          <span>${escapeHtml(event.source)}</span>
        </div>
        <p>${escapeHtml(event.body)}</p>
        <div class="artifact-row">
          ${event.artifact ? `<span class="artifact-chip">${escapeHtml(event.artifact)}</span>` : ""}
          ${event.command ? `<span class="artifact-chip command">${escapeHtml(event.command)}</span>` : ""}
          ${event.chip ? `<span class="artifact-chip state">${escapeHtml(event.chip)}</span>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderCostOverview(job) {
  const cost = jobCost(job);
  const cloud = state.processorStatus?.cloudSummary;
  return `
    <article class="cost-overview glass-panel">
      <div class="panel-head">
        <h2>Cost overview</h2>
        <span>${escapeHtml(cost ? formatUsageMethod(cost.codexCostMethod || cost.tokenUsageMethod) : "Unavailable")}</span>
      </div>
      <div class="cost-overview-grid">
        ${costOverviewCell("Est. cost today", cloud?.estimatedCostToday?.available ? formatUsd(cloud.estimatedCostToday.usd) : "No data", cloud?.estimatedCostToday?.method || "unavailable")}
        ${costOverviewCell("Selected job", formatUsd(cost?.totalOperationalCostUsd ?? cost?.totalEstimatedCostUsd ?? cost?.codexCostUsd), cost ? formatUsageMethod(cost.codexCostMethod || cost.tokenUsageMethod) : "unavailable")}
        <div class="cost-rhythm">
          <span>Cost rhythm (24h)</span>
          <div class="sparkline cost" aria-hidden="true"><i></i></div>
          <small>${escapeHtml(cloud?.estimatedCostToday?.available ? "From processed job telemetry" : "Unavailable")}</small>
        </div>
      </div>
    </article>
  `;
}

function renderCurrentGoalPanel(job) {
  const goal = currentGoal(job);
  const percent = goal.percent ?? completionPercent(job);
  return `
    <article class="rail-panel glass-panel">
      <div class="panel-head">
        <h2>Current goal</h2>
        <span>${escapeHtml(goal.unavailable ? "Unavailable" : "Active")}</span>
      </div>
      <p class="goal-focus">${escapeHtml(goal.label)}</p>
      ${thinProgress(percent)}
      <div class="rail-metric-line">
        <span>ETA</span>
        <strong>${escapeHtml(etaText(job, { short: true }))}</strong>
      </div>
    </article>
  `;
}

function renderContractGoalsPanel(job) {
  const goals = jobGoals(job);
  return `
    <article class="rail-panel glass-panel">
      <div class="panel-head">
        <h2>Contract goals</h2>
        <span>${escapeHtml(goals.length ? `${remainingGoals(job) ?? 0} remaining` : "Unavailable")}</span>
      </div>
      ${renderGoalRows(goals, jobSubgoals(job), { limit: 5, compact: true })}
    </article>
  `;
}

function renderProcessorPanel() {
  const status = state.processorStatus;
  const runtime = status?.runtime || {};
  const cursor = status?.cursor || {};
  return `
    <article class="rail-panel glass-panel">
      <div class="processor-mini-head">
        <span class="job-icon cube"></span>
        <div>
          <span>Processor</span>
          <strong>${escapeHtml(runtime.selectedProcessorInstance || "No active lease")}</strong>
        </div>
        ${statusChip(runtime.health || "unavailable")}
      </div>
      <div class="mini-runtime-grid">
        ${miniRuntime("Mode", runtime.mode || "Unavailable")}
        ${miniRuntime("Lease", formatStatus(runtime.leaseStatus || "No data"))}
        ${miniRuntime("Pending", cursor.pendingStreamCount ?? "No data")}
        ${miniRuntime("Behind", cursor.behindBySequence ?? "No data")}
        ${miniRuntime("Last run", formatRelative(runtime.lastRunAt))}
        ${miniRuntime("Health", formatStatus(runtime.health || "No data"))}
      </div>
    </article>
  `;
}

function renderJobContextPanel(job) {
  return `
    <article class="rail-panel glass-panel context-panel">
      ${contextRow("Workspace / Repo", job?.projectSlug || "No data")}
      ${contextRow("Branch", jobBranch(job))}
      ${contextRow("Remote host", job?.remoteHost || "No data")}
      ${contextRow("Raw chunks", job?.rawTelemetry?.rawChunkCount ?? state.detailRawChunks.length ?? "No data")}
    </article>
  `;
}

function renderJobHealthPanel(job) {
  const status = displayStatus(job);
  const raw = job?.rawTelemetry || {};
  const latest = latestActivity(job);
  return `
    <article class="rail-panel glass-panel">
      <div class="panel-head">
        <h2>Job health</h2>
        ${statusChip(healthForJob(job))}
      </div>
      <div class="job-health-grid">
        ${miniRuntime("Streams", raw.rawChunkCount ?? "No data")}
        ${miniRuntime("Behind", state.processorStatus?.cursor?.behindBySequence ?? "No data")}
        ${miniRuntime("Last event", latest ? formatRelative(job?.updatedAt || job?.lastSeenAt) : "No data")}
      </div>
      <div class="sparkline health" aria-hidden="true"><i></i></div>
      <p class="muted-line">${escapeHtml(latest || "No activity reported")}</p>
    </article>
  `;
}

function renderPlaceholderPage() {
  return `
    <section class="placeholder-page">
      <article class="placeholder-card glass-panel">
        <span class="placeholder-mark" aria-hidden="true"></span>
        <h1>Not implemented yet</h1>
      </article>
    </section>
  `;
}

function renderGoalRows(goals, subgoals, options = {}) {
  const safeGoals = goals.slice(0, options.limit || goals.length);
  if (!safeGoals.length) {
    return `
      <div class="unavailable-list">
        <div class="goal-row unavailable">
          <span class="goal-mark"></span>
          <div>
            <strong>Contract goals unavailable</strong>
            <span>No structured goals have arrived from telemetry.</span>
          </div>
          <em>Unavailable</em>
        </div>
      </div>
    `;
  }
  return `
    <div class="goal-list ${options.compact ? "compact" : ""}">
      ${safeGoals.map((goal) => {
        const children = subgoals.filter((subgoal) => subgoal.parentId && subgoal.parentId === goal.id);
        return goalRow(goal, children, options.compact);
      }).join("")}
    </div>
  `;
}

function goalRow(goal, children = [], compact = false) {
  const stateName = goalState(goal);
  const percent = goal.percent;
  return `
    <div class="goal-row state-${escapeAttribute(stateName)} ${compact ? "compact" : ""}">
      <span class="goal-mark" style="--p:${percent === null ? 0 : clamp(percent, 0, 100)}"></span>
      <div>
        <strong>${escapeHtml(goal.label)}</strong>
        <span>${escapeHtml(formatStatus(stateName))}${children.length ? ` / ${children.length} subgoals` : ""}</span>
      </div>
      <em>${escapeHtml(stateName === "complete" ? "Complete" : percent === null ? "Pending" : formatPercent(percent))}</em>
    </div>
  `;
}

function statCell(label, value, icon) {
  return `
    <div class="stat-cell">
      <span class="stat-icon ${escapeAttribute(icon)}"></span>
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    </div>
  `;
}

function miniStat(label, value) {
  return `
    <div class="mini-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function cloudCell(label, value, method) {
  return `
    <div class="cloud-cell">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(formatMethodLabel(method))}</small>
    </div>
  `;
}

function processorMetric(label, value, tone = "") {
  return `
    <div class="processor-metric tone-${escapeAttribute(statusClass(tone))}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function miniRuntime(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function contextRow(label, value) {
  return `
    <div class="context-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function costOverviewCell(label, value, method) {
  return `
    <div class="cost-overview-cell">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(formatMethodLabel(method))}</small>
    </div>
  `;
}

function progressArc(percent) {
  const value = percent === null ? 0 : clamp(percent, 0, 100);
  return `<span class="progress-arc ${percent === null ? "is-unavailable" : ""}" style="--p:${value}"></span>`;
}

function thinProgress(percent) {
  const value = percent === null ? 0 : clamp(percent, 0, 100);
  return `
    <div class="thin-progress ${percent === null ? "is-unavailable" : ""}">
      <span style="width:${value}%"></span>
    </div>
  `;
}

function statusChip(status) {
  const value = formatStatus(status || "unavailable");
  return `<span class="status-chip status-${escapeAttribute(statusClass(status))}"><i></i>${escapeHtml(value)}</span>`;
}

function alertBanner(title, message) {
  return `
    <section class="alert-banner glass-panel">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </section>
  `;
}

function emptyPanel(title, message) {
  return `
    <article class="empty-panel glass-panel">
      <span class="placeholder-mark" aria-hidden="true"></span>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </article>
  `;
}

function emptyMini(message) {
  return `<div class="empty-mini">${escapeHtml(message)}</div>`;
}

function skeletonNow() {
  return `
    <section class="now-layout">
      <div class="side-job-card glass-panel skeleton-card"></div>
      <article class="selected-job-card glass-panel skeleton-card large"></article>
      <div class="side-job-card glass-panel skeleton-card"></div>
    </section>
    <div class="carousel-dots"><button class="active"></button><button></button><button></button></div>
    <section class="instrument-row">
      <article class="instrument glass-panel skeleton-card"></article>
      <article class="instrument glass-panel skeleton-card"></article>
      <article class="instrument glass-panel skeleton-card"></article>
    </section>
  `;
}

function skeletonJobs() {
  return `
    <section class="jobs-page">
      <aside class="jobs-selector glass-panel skeleton-card"></aside>
      <div class="job-work-column">
        <article class="work-surface glass-panel skeleton-card large"></article>
        <article class="cost-overview glass-panel skeleton-card"></article>
      </div>
      <aside class="job-right-rail">
        <article class="rail-panel glass-panel skeleton-card"></article>
        <article class="rail-panel glass-panel skeleton-card"></article>
      </aside>
    </section>
  `;
}

function preferredJob(jobs) {
  return jobs.find((job) => job.status === "running" && !job.isStuck) ||
    jobs.find((job) => !terminalStatuses.has(job.status)) ||
    jobs[0] ||
    null;
}

function selectedJob() {
  if (state.detailJob?.id === state.selectedJobId) {
    return state.detailJob;
  }
  return state.jobs.find((job) => job.id === state.selectedJobId) || preferredJob(state.jobs);
}

function carouselJobs(selected) {
  const jobs = state.jobs;
  const index = Math.max(0, jobs.findIndex((job) => job.id === selected?.id));
  return {
    previous: jobs[index - 1] || jobs[index + 2] || null,
    next: jobs[index + 1] || jobs[index - 2] || null
  };
}

function currentProjectSlug() {
  return selectedJob()?.projectSlug || state.jobs[0]?.projectSlug || state.processedStreams[0]?.projectSlug || "agent-runner";
}

function displayStatus(job) {
  if (!job) {
    return "unavailable";
  }
  if (job.isStuck) {
    return "stuck";
  }
  return job.status || "unknown";
}

function jobTitle(job) {
  const human = firstString([
    job?.processed?.metadata?.sourceTitle,
    job?.sessionName,
    job?.summary?.title,
    job?.processed?.metadata?.sourceMetadata?.title
  ]);
  if (human && !looksLikeMachineId(human)) {
    return humanizeIdentifier(human);
  }
  const task = firstString([job?.taskId]);
  if (task && !looksLikeMachineId(task)) {
    return humanizeIdentifier(task);
  }
  const activity = firstString([
    job?.processed?.latestActivity,
    job?.summary?.currentActivity,
    job?.currentActivity
  ]);
  if (activity && !looksLikeMachineId(activity)) {
    return sentenceTitle(activity);
  }
  return job?.projectSlug ? `${humanizeIdentifier(job.projectSlug)} job` : "Untitled runner job";
}

function jobBranch(job) {
  return firstString([
    job?.telemetry?.git?.branch,
    job?.summary?.branch,
    job?.statusJson?.branch,
    job?.processed?.metadata?.sourceMetadata?.branch,
    job?.projectSlug
  ]) || "Branch unavailable";
}

function jobIconClass(job) {
  const text = `${jobTitle(job)} ${job?.projectSlug || ""}`.toLowerCase();
  if (text.includes("doc")) return "book";
  if (text.includes("test")) return "file";
  return "cube";
}

function normalizedTelemetry(job) {
  const telemetry = job?.telemetry && typeof job.telemetry === "object" ? job.telemetry : null;
  if (!telemetry) {
    return null;
  }
  return {
    ...telemetry,
    events: Array.isArray(telemetry.events) ? telemetry.events : [],
    files: Array.isArray(telemetry.files) ? telemetry.files : [],
    goals: Array.isArray(telemetry.goals) ? telemetry.goals : [],
    subgoals: Array.isArray(telemetry.subgoals) ? telemetry.subgoals : [],
    spend: telemetry.spend || job?.summary?.cost || null
  };
}

function jobGoals(job) {
  const telemetry = normalizedTelemetry(job);
  const candidates = [
    telemetry?.goals,
    job?.summary?.goals,
    job?.statusJson?.goals,
    job?.processed?.metadata?.goals
  ];
  for (const candidate of candidates) {
    const goals = normalizeGoals(candidate);
    if (goals.length) {
      return goals;
    }
  }
  return [];
}

function jobSubgoals(job) {
  const telemetry = normalizedTelemetry(job);
  const candidates = [
    telemetry?.subgoals,
    job?.summary?.subgoals,
    job?.statusJson?.subgoals,
    job?.processed?.metadata?.subgoals
  ];
  for (const candidate of candidates) {
    const goals = normalizeGoals(candidate);
    if (goals.length) {
      return goals;
    }
  }
  return [];
}

function normalizeGoals(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((goal, index) => {
      if (typeof goal === "string") {
        return {
          id: `goal-${index}`,
          label: goal,
          state: "unknown",
          percent: null,
          parentId: null
        };
      }
      if (!goal || typeof goal !== "object") {
        return null;
      }
      const state = normalizeGoalState(goal.state || goal.status || goal.phase);
      const percent = numberOrNull(goal.percent ?? goal.progressPercent ?? goal.progress?.percent);
      return {
        id: String(goal.id || goal.key || `goal-${index}`),
        label: firstString([goal.label, goal.title, goal.name, goal.description]) || `Goal ${index + 1}`,
        state,
        percent: percent ?? (state === "complete" ? 100 : null),
        parentId: goal.parentId || goal.parent_id || null
      };
    })
    .filter(Boolean);
}

function normalizeGoalState(value) {
  const state = String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (["complete", "completed", "done", "passed"].includes(state)) return "complete";
  if (["active", "in_progress", "running", "current"].includes(state)) return "active";
  if (["blocked", "failed"].includes(state)) return "blocked";
  if (["pending", "queued", "not_started", "todo"].includes(state)) return "pending";
  return state || "unknown";
}

function goalState(goal) {
  return normalizeGoalState(goal?.state);
}

function currentGoal(job) {
  const goals = jobGoals(job);
  const active = goals.find((goal) => goalState(goal) === "active") ||
    goals.find((goal) => !["complete"].includes(goalState(goal))) ||
    goals[0];
  if (active) {
    return active;
  }
  return {
    label: "Contract goals unavailable",
    state: "unknown",
    percent: null,
    unavailable: true
  };
}

function currentSubgoal(job) {
  const subgoals = jobSubgoals(job);
  const active = subgoals.find((goal) => goalState(goal) === "active") ||
    subgoals.find((goal) => !["complete"].includes(goalState(goal)));
  if (active) {
    return active;
  }
  const goal = currentGoal(job);
  if (!goal.unavailable) {
    return goal;
  }
  return {
    label: latestActivity(job) || "No current subgoal reported",
    state: "unknown",
    percent: null,
    unavailable: true
  };
}

function completionPercent(job) {
  const telemetry = normalizedTelemetry(job);
  const direct = numberOrNull(telemetry?.progress?.percent ?? job?.summary?.progressPercent ?? job?.progressPercent);
  if (direct !== null) {
    return clamp(direct, 0, 100);
  }
  const goals = jobGoals(job);
  if (goals.length) {
    const complete = goals.filter((goal) => goalState(goal) === "complete").length;
    return Math.round((complete / goals.length) * 100);
  }
  if (job?.status === "completed") {
    return 100;
  }
  return null;
}

function remainingGoals(job) {
  const goals = jobGoals(job);
  if (!goals.length) {
    return null;
  }
  return goals.filter((goal) => goalState(goal) !== "complete").length;
}

function latestActivity(job) {
  const telemetry = normalizedTelemetry(job);
  return firstString([
    job?.processed?.latestActivity,
    telemetry?.currentActivity,
    job?.summary?.currentActivity,
    job?.currentActivity,
    job?.processed?.summary
  ]);
}

function jobFiles(job) {
  const telemetry = normalizedTelemetry(job);
  const files = [];
  if (Array.isArray(telemetry?.files)) {
    files.push(...telemetry.files);
  }
  if (Array.isArray(job?.processed?.files)) {
    files.push(...job.processed.files);
  }
  return files
    .map((file) => typeof file === "string" ? { path: file } : file)
    .filter((file) => file?.path)
    .slice(0, 6);
}

function jobCost(job) {
  const telemetry = normalizedTelemetry(job);
  return job?.processed?.cost || telemetry?.spend || job?.summary?.cost || null;
}

function workStream(job) {
  const telemetry = normalizedTelemetry(job);
  const rawEvents = Array.isArray(telemetry?.events) ? telemetry.events.slice(-5) : [];
  if (rawEvents.length >= 3) {
    return {
      semantic: true,
      events: rawEvents.map((event) => ({
        title: event.label || formatStatus(event.type || "Activity"),
        body: event.detail || event.command?.text || event.filePath || "Structured event observed.",
        time: formatClock(event.timestamp || job?.updatedAt),
        source: "Live",
        icon: iconForEvent(event.type),
        tone: event.severity || "info",
        artifact: event.filePath || "",
        command: event.command?.text || "",
        chip: formatStatus(event.type || "event")
      }))
    };
  }

  const processed = job?.processed || {};
  const files = jobFiles(job);
  const command = latestCommand(processed);
  const current = currentSubgoal(job);
  const activity = latestActivity(job);
  const events = [];
  if (activity) {
    events.push({
      title: "Status update",
      body: activity,
      time: formatClock(job?.updatedAt || job?.lastSeenAt),
      source: processed.processedAt ? "Job telemetry" : "Job status",
      icon: "search",
      tone: "info",
      chip: processed.processedAt ? "Processed" : "Reported"
    });
  } else {
    events.push({
      title: "Status update",
      body: "No activity text has been reported for this job yet.",
      time: "Pending",
      source: "Unavailable",
      icon: "search",
      tone: "warning",
      chip: "Unavailable"
    });
  }
  events.push({
    title: files[0] ? "File or artifact observed" : "File context unavailable",
    body: files[0] ? "A referenced file is available from processed telemetry." : "No file or artifact chip is available for this job.",
    time: formatClock(processed.processedAt || job?.updatedAt),
    source: files[0] ? "Job telemetry" : "Skeleton",
    icon: "file",
    tone: files[0] ? "info" : "warning",
    artifact: files[0]?.path || "",
    chip: files[0] ? "Artifact" : "Unavailable"
  });
  events.push({
    title: command ? "Command/test signal" : "Command signal unavailable",
    body: command ? command.label || command.command || "Command activity was observed." : "No command or test chip has been extracted yet.",
    time: formatClock(command?.timestamp || processed.processedAt || job?.updatedAt),
    source: command ? "Job telemetry" : "Skeleton",
    icon: "code",
    tone: command?.failed ? "error" : command ? "success" : "warning",
    command: command?.command || "",
    chip: command ? (command.failed ? "Failed" : "Observed") : "Unavailable"
  });
  events.push({
    title: "Goal update",
    body: current.label,
    time: formatClock(processed.processedAt || job?.updatedAt),
    source: current.unavailable ? "Skeleton" : "Goal telemetry",
    icon: "target",
    tone: current.unavailable ? "warning" : "info",
    chip: current.unavailable ? "Unavailable" : formatStatus(current.state)
  });
  events.push({
    title: "Next action",
    body: processed.nextAction || "Next action has not been reported yet.",
    time: formatClock(processed.processedAt || job?.updatedAt),
    source: processed.nextAction ? "Processed stream" : "Skeleton",
    icon: "cube",
    tone: processed.nextAction ? "info" : "warning",
    chip: processed.nextAction ? "Next" : "Pending"
  });
  return { semantic: false, events };
}

function latestCommand(processed) {
  const metadata = processed?.metadata || {};
  const commands = Array.isArray(metadata.commandActivity) ? metadata.commandActivity : [];
  const tools = Array.isArray(metadata.toolActivity) ? metadata.toolActivity : [];
  return commands.at(-1) || tools.at(-1) || null;
}

function iconForEvent(type) {
  if (String(type || "").includes("file")) return "file";
  if (String(type || "").includes("command")) return "code";
  if (String(type || "").includes("goal")) return "target";
  return "search";
}

function healthForJob(job) {
  if (!job) return "unavailable";
  if (job.status === "failed" || job.isStuck) return "error";
  if (job.rawTelemetry?.rawStale || job.processed?.freshness?.processedStale) return "warning";
  if (job.status === "running" || job.status === "completed") return "healthy";
  return job.status || "unknown";
}

function elapsedText(job) {
  if (!job?.startedAt) {
    return "Unavailable";
  }
  const start = Date.parse(job.startedAt);
  const end = Date.parse(job.finishedAt || "") || Date.now();
  if (!Number.isFinite(start)) {
    return "Unavailable";
  }
  return formatDuration(Math.max(0, end - start));
}

function etaText(job, options = {}) {
  const min = numberOrNull(job?.etaMinutesMin ?? job?.summary?.etaMinutesMin);
  const max = numberOrNull(job?.etaMinutesMax ?? job?.summary?.etaMinutesMax);
  if (min === null && max === null) {
    return options.short ? "No ETA" : "No ETA";
  }
  if (min !== null && max !== null && min !== max) {
    return `${formatMinuteNumber(min)}-${formatMinuteNumber(max)}m`;
  }
  return `${formatMinuteNumber(min ?? max)}m`;
}

function formatMinuteNumber(value) {
  return Number(value).toFixed(value < 10 && value % 1 ? 1 : 0);
}

function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) {
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const dayHours = hours % 24;
  return dayHours ? `${days}d ${dayHours}h` : `${days}d`;
}

function formatClock(value) {
  if (!value) {
    return "Pending";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Pending";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatRelative(value) {
  if (!value) {
    return "No data";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No data";
  }
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function freshnessText() {
  if (!state.lastUpdatedAt) {
    return "Never updated";
  }
  return "Updated " + formatClock(state.lastUpdatedAt.toISOString());
}

function formatTokenRate(job, cost) {
  const tokens = numberOrNull(cost?.totalTokens ?? job?.processed?.tokenUsage?.totalTokens);
  if (tokens === null || !job?.startedAt) {
    return "No data";
  }
  const start = Date.parse(job.startedAt);
  const end = Date.parse(job.finishedAt || "") || Date.now();
  const minutes = Math.max(1, (end - start) / 60000);
  return `${formatCompactNumber(tokens / minutes)}/min`;
}

function formatTokenBurn(value) {
  const tokens = numberOrNull(value?.tokens);
  return tokens === null ? "No data" : formatCompactNumber(tokens);
}

function formatLimitTokens(value) {
  if (!value || typeof value !== "object") {
    return "No data yet";
  }
  const used = numberOrNull(value.usedTokens);
  const limit = numberOrNull(value.limitTokens);
  if (used !== null && limit !== null) {
    return `${formatCompactNumber(used)} / ${formatCompactNumber(limit)} tokens`;
  }
  if (limit !== null) {
    return `${formatCompactNumber(limit)} token limit`;
  }
  return "Limit unavailable";
}

function formatUsd(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) {
    return "No data";
  }
  return "$" + numeric.toFixed(numeric < 0.01 ? 4 : 2);
}

function formatBytes(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) {
    return "No data";
  }
  if (numeric < 1024) return `${numeric} B`;
  if (numeric < 1024 * 1024) return `${(numeric / 1024).toFixed(1)} KB`;
  if (numeric < 1024 * 1024 * 1024) return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
  return `${(numeric / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatCompactNumber(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) {
    return "No data";
  }
  return new Intl.NumberFormat(undefined, {
    notation: numeric >= 10000 ? "compact" : "standard",
    maximumFractionDigits: numeric >= 10000 ? 1 : 0
  }).format(numeric);
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function formatStatus(value) {
  const words = String(value || "unknown").replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatUsageMethod(value) {
  return ["measured", "allocated", "estimated", "unknown"].includes(value) ? value : "unknown";
}

function formatMethodLabel(value) {
  if (!value || value === "unavailable") {
    return "Unavailable";
  }
  if (value.includes("estimate")) {
    return "Estimated";
  }
  if (value.includes("derived")) {
    return "Derived";
  }
  if (value.includes("measured")) {
    return "Measured";
  }
  return formatStatus(value);
}

function humanizeIdentifier(value) {
  const text = String(value || "")
    .replace(/^runner-job:/, "")
    .split(":")
    .at(-1)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!text) {
    return "Selected job";
  }
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sentenceTitle(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) {
    return "Untitled runner job";
  }
  const clipped = text.length > 72 ? text.slice(0, 69).trimEnd() + "..." : text;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

function looksLikeMachineId(value) {
  const text = String(value || "").trim();
  if (!text) {
    return true;
  }
  const compact = text.replace(/[^a-z0-9]/gi, "");
  if (/^\d{8,}t?\d*/i.test(compact)) {
    return true;
  }
  if (/^[a-f0-9]{12,}$/i.test(compact)) {
    return true;
  }
  if (/^[a-z0-9_-]{18,}$/i.test(text) && !/[aeiou]{2,}/i.test(text)) {
    return true;
  }
  return false;
}

function shortId(value) {
  return String(value || "Unavailable").slice(0, 10);
}

function statusClass(value) {
  const normalized = String(value || "unavailable").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (["active", "running", "healthy", "complete", "completed"].includes(normalized)) return normalized === "completed" ? "complete" : normalized;
  if (["queued", "waiting", "warning", "stuck", "pending"].includes(normalized)) return normalized;
  if (["failed", "error", "stopped"].includes(normalized)) return "error";
  return normalized || "unavailable";
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
