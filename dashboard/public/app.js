const tokenKey = "agent-runner-dashboard-token";
const state = {
  token: localStorage.getItem(tokenKey) || "",
  view: "jobs",
  jobs: [],
  threads: [],
  activity: [],
  processedStreams: [],
  memories: [],
  processorStatus: null,
  selectedMemoryId: null,
  selectedId: null,
  selectedThreadId: null,
  detailJob: null,
  detailHistory: [],
  detailThread: null,
  detailRawChunks: [],
  detailLatestActivity: [],
  linkedRunnerJob: null,
  eventFilter: "activity",
  seenEvents: new Map(),
  loading: false,
  error: null,
  lastUpdatedAt: null
};

const elements = {
  refreshButton: document.querySelector("#refresh-button"),
  viewTabs: document.querySelector(".view-tabs"),
  jobs: document.querySelector("#jobs"),
  detail: document.querySelector("#detail"),
  lastUpdated: document.querySelector("#last-updated"),
  jobCount: document.querySelector("#job-count"),
  listEyebrow: document.querySelector("#list-eyebrow"),
  listTitle: document.querySelector("#list-title"),
  running: document.querySelector("#metric-running"),
  stuck: document.querySelector("#metric-stuck"),
  completed: document.querySelector("#metric-completed"),
  failed: document.querySelector("#metric-failed")
};

elements.refreshButton.addEventListener("click", () => loadDashboard());
for (const button of elements.viewTabs.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
    if (state.view === "jobs" && state.selectedId) {
      loadDetail(state.selectedId, { preserveList: true });
    } else if (state.view === "threads" && state.selectedThreadId) {
      loadThreadDetail(state.selectedThreadId, { preserveList: true });
    }
  });
}

setInterval(() => {
  if (!state.loading) {
    loadDashboard({ quiet: true });
  }
}, 15000);

render();
loadDashboard();

async function loadJobs(options = {}) {
  return loadDashboard(options);
}

async function loadDashboard(options = {}) {
  state.loading = true;
  state.error = null;
  setRefreshing(true);
  if (!options.quiet) {
    render();
  }

  try {
    const [jobsResponse, threadsResponse, activityResponse, processedResponse, memoryResponse] = await Promise.all([
      api("/api/jobs"),
      api("/api/threads").catch(() => ({ threads: [] })),
      api("/api/activity").catch(() => ({ activity: [] })),
      api("/api/processed-streams").catch(() => ({ streams: [] })),
      api("/api/memory").catch(() => ({ memories: [] }))
    ]);
    state.jobs = jobsResponse.jobs || [];
    state.threads = threadsResponse.threads || [];
    state.activity = activityResponse.activity || [];
    state.processedStreams = processedResponse.streams || [];
    state.memories = memoryResponse.memories || [];
    if (!state.memories.some((memory) => memory.id === state.selectedMemoryId)) {
      state.selectedMemoryId = state.memories[0]?.id || null;
    }
    const projectSlug = currentProjectSlug();
    state.processorStatus = projectSlug
      ? await api("/api/processor?projectSlug=" + encodeURIComponent(projectSlug)).catch(() => null)
      : null;
    if (!state.jobs.some((job) => job.id === state.selectedId)) {
      state.selectedId = state.jobs[0]?.id || null;
      state.detailJob = null;
      state.detailHistory = [];
    }
    if (!state.threads.some((thread) => thread.id === state.selectedThreadId)) {
      state.selectedThreadId = state.threads[0]?.id || null;
      state.detailThread = null;
      state.detailRawChunks = [];
      state.detailLatestActivity = [];
      state.linkedRunnerJob = null;
    }
    state.lastUpdatedAt = new Date();
    render();
    if (state.view === "jobs" && state.selectedId) {
      await loadDetail(state.selectedId, { preserveList: true });
    } else if (state.view === "threads" && state.selectedThreadId) {
      await loadThreadDetail(state.selectedThreadId, { preserveList: true });
    }
  } catch (error) {
    state.error = error;
    if (!options.quiet) {
      renderError(error, "list");
    }
  } finally {
    state.loading = false;
    setRefreshing(false);
    render();
  }
}

async function loadDetail(id, options = {}) {
  state.selectedId = id;
  if (!options.preserveList) {
    render();
  }

  try {
    const data = await api("/api/jobs/" + encodeURIComponent(id));
    state.detailJob = data.job;
    state.detailHistory = data.history || [];
    state.detailRawChunks = data.rawChunks || [];
    renderDetail(data.job, data.history || [], data.rawChunks || []);
  } catch (error) {
    renderError(error, "detail");
  }
}

async function loadThreadDetail(id, options = {}) {
  state.selectedThreadId = id;
  if (!options.preserveList) {
    render();
  }

  try {
    const data = await api("/api/threads/" + encodeURIComponent(id));
    state.detailThread = data.thread;
    state.detailRawChunks = data.rawChunks || [];
    state.detailLatestActivity = data.latestActivity || [];
    state.linkedRunnerJob = data.linkedRunnerJob || null;
    renderThreadDetail(data.thread, data.rawChunks || [], data.latestActivity || [], data.linkedRunnerJob || null);
  } catch (error) {
    renderError(error, "detail");
  }
}

async function api(path) {
  const headers = {};
  if (state.token) {
    headers.authorization = "Bearer " + state.token;
  }
  const response = await fetch(path, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

function render() {
  renderViewTabs();
  renderMetrics();
  if (state.view === "threads") {
    renderThreads();
  } else if (state.view === "memory") {
    renderMemory();
  } else if (state.view === "processor") {
    renderProcessor();
  } else if (state.view === "overview") {
    renderOverview();
  } else {
    renderJobs();
  }
  renderFreshness();
  if (state.view === "jobs" && !state.selectedId) {
    elements.detail.className = "detail";
    elements.detail.innerHTML = state.loading ? detailSkeleton() : emptyDetail();
  } else if (state.view === "threads" && !state.selectedThreadId) {
    elements.detail.className = "detail";
    elements.detail.innerHTML = state.loading ? detailSkeleton() : emptyState("No local threads", "Local Codex telemetry will appear after the local service uploads.");
  } else if (state.view === "overview") {
    renderOverviewDetail();
  } else if (state.view === "memory") {
    renderMemoryDetail();
  } else if (state.view === "processor") {
    renderProcessorDetail();
  }
}

function renderViewTabs() {
  for (const button of elements.viewTabs.querySelectorAll("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === state.view);
  }
}

function renderMetrics() {
  elements.running.textContent = state.jobs.filter((job) => job.status === "running" && !job.isStuck).length;
  elements.stuck.textContent = state.jobs.filter((job) => job.isStuck).length;
  elements.completed.textContent = state.jobs.filter((job) => job.status === "completed").length;
  elements.failed.textContent = state.jobs.filter((job) => job.status === "failed").length;
}

function renderFreshness() {
  if (!state.lastUpdatedAt) {
    elements.lastUpdated.textContent = "Never updated";
    return;
  }
  elements.lastUpdated.textContent = "Updated " + formatRefreshTime(state.lastUpdatedAt);
  elements.lastUpdated.title = state.lastUpdatedAt.toISOString();
}

function renderJobs() {
  elements.listEyebrow.textContent = "Remote runners";
  elements.listTitle.textContent = "Runner Jobs";
  elements.jobCount.textContent = `${state.jobs.length} ${state.jobs.length === 1 ? "job" : "jobs"}`;
  if (state.loading && !state.jobs.length) {
    elements.jobs.innerHTML = listSkeleton();
    return;
  }

  if (state.error && !state.jobs.length) {
    elements.jobs.innerHTML = errorState(state.error.message || String(state.error), "Unable to load jobs");
    return;
  }

  if (!state.jobs.length) {
    elements.jobs.innerHTML = emptyState("No jobs yet", "Runner updates will appear here after the first ingest.", { compact: true });
    return;
  }

  elements.jobs.innerHTML = state.jobs.map((job) => {
    const telemetry = normalizedTelemetry(job);
    const percent = progressPercent(job);
    const status = job.isStuck ? "stuck" : job.status || "unknown";
    const className = statusClass(status);
    const activity = job.processed?.latestActivity || telemetry?.currentActivity || job.summary?.currentActivity || job.currentActivity || "No activity reported";
    const eventCount = telemetry?.events?.length || 0;
    return `
      <button class="job-row status-${className} ${job.id === state.selectedId ? "active" : ""}" data-job-id="${escapeAttribute(job.id)}">
        <span class="job-row-main">
          <span class="row-leading">
            <span class="status-dot" aria-hidden="true"></span>
            <span class="project" title="${escapeAttribute(job.projectSlug)}">${escapeHtml(job.projectSlug)}</span>
          </span>
          <span class="status ${className}">${escapeHtml(formatStatus(status))}</span>
        </span>
        <span class="job-meta-line">
          <span class="task-id" title="${escapeAttribute(job.taskId)}">${escapeHtml(job.taskId)}</span>
          <span class="time">${escapeHtml(formatTime(job.updatedAt))}</span>
        </span>
        <span class="activity" title="${escapeAttribute(activity)}">${escapeHtml(activity)}</span>
        <span class="row-progress">
          <span class="progress"><span style="width: ${percent}%"></span></span>
          <span class="progress-label">${escapeHtml(percentDisplay(job))}</span>
        </span>
        <span class="job-telemetry-line">
          <span>${escapeHtml(eventCount ? `${eventCount} events` : "no events")}</span>
          <span>${escapeHtml(formatProcessedLine(job.processed) || formatRawLine(job.rawTelemetry) || formatSpendSource(telemetry?.spend || job.summary?.cost))}</span>
        </span>
      </button>
    `;
  }).join("");

  for (const row of elements.jobs.querySelectorAll("[data-job-id]")) {
    row.addEventListener("click", () => loadDetail(row.dataset.jobId));
  }
}

function renderThreads() {
  elements.listEyebrow.textContent = "Local Codex";
  elements.listTitle.textContent = "Local Threads";
  elements.jobCount.textContent = `${state.threads.length} ${state.threads.length === 1 ? "thread" : "threads"}`;
  if (state.loading && !state.threads.length) {
    elements.jobs.innerHTML = listSkeleton();
    return;
  }
  if (!state.threads.length) {
    elements.jobs.innerHTML = emptyState("No local threads", "Run agent-runner telemetry flush or start the local service.", { compact: true });
    return;
  }
  elements.jobs.innerHTML = state.threads.map((thread) => {
    const status = thread.status || "unknown";
    const className = statusClass(status);
    const title = thread.title || thread.threadId;
    const activity = thread.processed?.latestActivity || thread.latestActivity || "No local activity reported";
    return `
      <button class="job-row thread-row status-${className} ${thread.id === state.selectedThreadId ? "active" : ""}" data-thread-id="${escapeAttribute(thread.id)}">
        <span class="job-row-main">
          <span class="row-leading">
            <span class="status-dot" aria-hidden="true"></span>
            <span class="project" title="${escapeAttribute(thread.projectSlug)}">${escapeHtml(thread.projectSlug)}</span>
          </span>
          <span class="entity-pill">${escapeHtml(formatSourceKind(thread.sourceKind))}</span>
        </span>
        <span class="job-meta-line">
          <span class="task-id" title="${escapeAttribute(title)}">${escapeHtml(title)}</span>
          <span class="time">${escapeHtml(formatTime(thread.updatedAt))}</span>
        </span>
        <span class="activity" title="${escapeAttribute(activity)}">${escapeHtml(activity)}</span>
        <span class="job-telemetry-line">
          <span>${escapeHtml(formatStatus(status))}</span>
          <span>${escapeHtml(formatProcessedLine(thread.processed) || formatRawLine({ rawChunkCount: thread.rawChunkCount, latestRawTelemetryAt: thread.latestRawTelemetryAt, rawStale: thread.freshness?.rawStale }))}</span>
        </span>
      </button>
    `;
  }).join("");
  for (const row of elements.jobs.querySelectorAll("[data-thread-id]")) {
    row.addEventListener("click", () => loadThreadDetail(row.dataset.threadId));
  }
}

function renderOverview() {
  elements.listEyebrow.textContent = "Recent";
  elements.listTitle.textContent = "Activity";
  elements.jobCount.textContent = `${state.activity.length} items`;
  const items = state.activity.length ? state.activity : [
    ...state.jobs.slice(0, 10).map((job) => ({
      type: "runner-job",
      label: "Runner job",
      id: job.id,
      projectSlug: job.projectSlug,
      title: job.taskId,
      status: job.status,
      activity: job.currentActivity,
      updatedAt: job.updatedAt,
      rawChunkCount: job.rawTelemetry?.rawChunkCount || 0,
      latestRawTelemetryAt: job.rawTelemetry?.latestRawTelemetryAt
    })),
    ...state.threads.slice(0, 10).map((thread) => ({
      type: thread.sourceKind === "codex-ide-thread" ? "ide-thread" : thread.sourceKind === "local-workspace" ? "workspace" : "cli-thread",
      label: thread.sourceKind === "codex-ide-thread" ? "IDE thread" : thread.sourceKind === "local-workspace" ? "Workspace telemetry" : "CLI thread",
      id: thread.id,
      projectSlug: thread.projectSlug,
      title: thread.title || thread.threadId,
      status: thread.status,
      activity: thread.latestActivity,
      updatedAt: thread.updatedAt,
      rawChunkCount: thread.rawChunkCount || 0,
      latestRawTelemetryAt: thread.latestRawTelemetryAt
    }))
  ].sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
  if (!items.length) {
    elements.jobs.innerHTML = emptyState("No activity", "Runner jobs and local threads will appear here after ingest.", { compact: true });
    return;
  }
  elements.jobs.innerHTML = items.map((item) => `
    <button class="job-row activity-row status-${statusClass(item.status)}" data-activity-type="${escapeAttribute(item.type)}" data-activity-id="${escapeAttribute(item.id)}">
      <span class="job-row-main">
        <span class="row-leading">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="project">${escapeHtml(item.projectSlug)}</span>
        </span>
        <span class="entity-pill">${escapeHtml(item.label)}</span>
      </span>
      <span class="job-meta-line">
        <span class="task-id" title="${escapeAttribute(item.title)}">${escapeHtml(item.title)}</span>
        <span class="time">${escapeHtml(formatTime(item.updatedAt))}</span>
      </span>
      <span class="activity">${escapeHtml(item.activity || "No activity reported")}</span>
      <span class="job-telemetry-line">
        <span>${escapeHtml(formatStatus(item.status))}</span>
        <span>${escapeHtml(formatRawLine(item))}</span>
      </span>
    </button>
  `).join("");
  for (const row of elements.jobs.querySelectorAll("[data-activity-id]")) {
    row.addEventListener("click", () => {
      if (row.dataset.activityType === "runner-job") {
        state.view = "jobs";
        loadDetail(row.dataset.activityId);
      } else {
        state.view = "threads";
        loadThreadDetail(row.dataset.activityId);
      }
    });
  }
}

function renderMemory() {
  elements.listEyebrow.textContent = "Project";
  elements.listTitle.textContent = "Memory";
  elements.jobCount.textContent = `${state.memories.length} ${state.memories.length === 1 ? "item" : "items"}`;
  if (!state.memories.length) {
    elements.jobs.innerHTML = emptyState("No project memory", "Durable facts will appear after repeated or explicit evidence is processed.", { compact: true });
    return;
  }
  elements.jobs.innerHTML = state.memories.map((memory) => `
    <button class="job-row memory-row ${memory.id === state.selectedMemoryId ? "active" : ""}" data-memory-id="${escapeAttribute(memory.id)}">
      <span class="job-row-main">
        <span class="row-leading">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="project">${escapeHtml(formatStatus(memory.memoryKind))}</span>
        </span>
        <span class="entity-pill">${escapeHtml(memory.evidenceStrength || "observed")}</span>
      </span>
      <span class="job-meta-line">
        <span class="task-id" title="${escapeAttribute(memory.title)}">${escapeHtml(memory.title)}</span>
        <span class="time">${escapeHtml(formatTime(memory.updatedAt))}</span>
      </span>
      <span class="activity" title="${escapeAttribute(memory.body)}">${escapeHtml(memory.body)}</span>
      <span class="job-telemetry-line">
        <span>${escapeHtml(memory.modelConfidence ? `${memory.modelConfidence} model confidence` : "evidence based")}</span>
        <span>${escapeHtml(`${memory.evidence?.length || 0} evidence`)}</span>
      </span>
    </button>
  `).join("");
  for (const row of elements.jobs.querySelectorAll("[data-memory-id]")) {
    row.addEventListener("click", () => {
      state.selectedMemoryId = row.dataset.memoryId;
      render();
    });
  }
}

function renderProcessor() {
  const status = state.processorStatus || {};
  const cursor = status.cursor || {};
  const warnings = Array.isArray(status.warnings) ? status.warnings : [];
  elements.listEyebrow.textContent = "Processing";
  elements.listTitle.textContent = "Status";
  elements.jobCount.textContent = status.projectSlug || "current project";
  elements.jobs.innerHTML = `
    <button class="job-row active">
      <span class="job-row-main">
        <span class="row-leading">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="project">Automatic</span>
        </span>
        <span class="entity-pill">${escapeHtml(status.automatic?.paused ? "paused" : "enabled")}</span>
      </span>
      <span class="activity">${escapeHtml(status.automatic?.mode || "wake on ingest or local loop")}</span>
    </button>
    <button class="job-row">
      <span class="job-row-main">
        <span class="row-leading">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="project">Cursor</span>
        </span>
        <span class="entity-pill">${escapeHtml(`${cursor.pendingStreamCount ?? 0} pending`)}</span>
      </span>
      <span class="activity">${escapeHtml(`raw ${cursor.latestRawSequence ?? "n/a"} / processed ${cursor.latestProcessedSequence ?? "n/a"}`)}</span>
    </button>
    ${warnings.map((warning) => `
      <button class="job-row status-stuck">
        <span class="job-row-main">
          <span class="row-leading">
            <span class="status-dot" aria-hidden="true"></span>
            <span class="project">${escapeHtml(formatStatus(warning.kind))}</span>
          </span>
          <span class="status stuck">${escapeHtml(warning.severity || "warning")}</span>
        </span>
        <span class="activity">${escapeHtml(warning.message || "")}</span>
      </button>
    `).join("")}
  `;
}

function renderDetail(job, history, rawChunks = []) {
  const summary = job.summary || {};
  const telemetry = normalizedTelemetry(job);
  const status = job.isStuck ? "stuck" : job.status || "unknown";
  const className = statusClass(status);
  const percent = progressPercent(job);
  const activity = job.processed?.latestActivity || telemetry?.currentActivity || summary.currentActivity || job.currentActivity || "No activity reported";
  const events = telemetry?.events || [];
  const files = telemetry?.files?.length ? telemetry.files : aggregateFilesFromEvents(events);
  const spend = telemetry?.spend || summary.cost || {};
  const goals = telemetry?.goals?.length ? telemetry.goals : summary.goals || [];
  const subgoals = telemetry?.subgoals?.length ? telemetry.subgoals : summary.subgoals || [];
  const newEventIds = unseenEventIds(job.id, events);

  elements.detail.className = `detail status-${className}`;
  elements.detail.innerHTML = `
    <div class="detail-head status-${className}">
      <div class="detail-title">
        <p class="eyebrow" title="${escapeAttribute(job.projectSlug)}">${escapeHtml(job.projectSlug)}</p>
        <h2 title="${escapeAttribute(job.taskId)}">${escapeHtml(job.taskId)}</h2>
        <p class="detail-subline">${escapeHtml(detailSubline(job))}</p>
      </div>
      <span class="status ${className}">${escapeHtml(formatStatus(status))}</span>
    </div>

    <section class="activity-hero status-${className}">
      <div class="activity-copy">
        <span class="section-label">Current activity</span>
        <p>${escapeHtml(activity)}</p>
      </div>
      <div class="progress-readout">
        <strong>${escapeHtml(formatPercent(percent))}</strong>
        <span>${escapeHtml(summary.progressConfidence ? summary.progressConfidence + " confidence" : "unknown confidence")}</span>
      </div>
      <div class="progress large"><span style="width: ${percent}%"></span></div>
    </section>

    <section class="detail-grid" aria-label="Job detail metrics">
      <div><span>Progress</span><strong>${escapeHtml(percentDisplay(job))}</strong></div>
      <div><span>ETA</span><strong>${escapeHtml(formatEta(summary))}</strong></div>
      <div><span>Codex</span><strong>${escapeHtml(formatUsd(spend.codexTaskAllocationUsd ?? spend.codexTokenCostUsd))}</strong></div>
      <div><span>Tokens</span><strong>${escapeHtml(formatTokens(spend))}</strong></div>
      <div><span>Started</span><strong>${escapeHtml(formatTime(job.startedAt))}</strong></div>
      <div><span>Finished</span><strong>${escapeHtml(formatTime(job.finishedAt))}</strong></div>
      <div><span>Exit</span><strong>${escapeHtml(job.exitCode ?? "n/a")}</strong></div>
      <div><span>Last Seen</span><strong>${escapeHtml(formatTime(job.lastSeenAt))}</strong></div>
    </section>

    <div class="detail-body">
      ${processedBlock(job.processed)}
      ${spendBlock(spend)}
      ${rawTelemetryBlock(job.rawTelemetry, rawChunks, "Runner Raw Telemetry")}
      ${goalsBlock(goals, subgoals, percent)}
      ${telemetryBlock(events, files, newEventIds)}
      ${historyBlock(history)}
      ${logBlock(job.logTail)}
    </div>
  `;

  for (const button of elements.detail.querySelectorAll("[data-filter]")) {
    button.addEventListener("click", () => {
      state.eventFilter = button.dataset.filter;
      renderDetail(job, history);
    });
  }
  markEventsSeen(job.id, events);
}

function renderThreadDetail(thread, rawChunks, latestActivity, linkedRunnerJob) {
  const status = thread.status || "unknown";
  const className = statusClass(status);
  const title = thread.title || thread.threadId;
  const usage = thread.processed?.tokenUsage || thread.tokenUsage || {};
  const activity = thread.processed?.latestActivity || thread.latestActivity || "No local activity reported";
  elements.detail.className = `detail status-${className}`;
  elements.detail.innerHTML = `
    <div class="detail-head status-${className}">
      <div class="detail-title">
        <p class="eyebrow">${escapeHtml(formatSourceKind(thread.sourceKind))}</p>
        <h2 title="${escapeAttribute(title)}">${escapeHtml(title)}</h2>
        <p class="detail-subline">${escapeHtml(threadSubline(thread))}</p>
      </div>
      <span class="status ${className}">${escapeHtml(formatStatus(status))}</span>
    </div>

    <section class="activity-hero status-${className}">
      <div class="activity-copy">
        <span class="section-label">Latest local activity</span>
        <p>${escapeHtml(activity)}</p>
      </div>
      <div class="progress-readout">
        <strong>${escapeHtml(formatTokens(usage))}</strong>
        <span>tokens observed</span>
      </div>
      <div class="progress large"><span style="width: ${thread.freshness?.rawStale ? 35 : 100}%"></span></div>
    </section>

    <section class="detail-grid" aria-label="Thread detail metrics">
      <div><span>Source</span><strong>${escapeHtml(formatSourceKind(thread.sourceKind))}</strong></div>
      <div><span>Project</span><strong>${escapeHtml(thread.projectSlug)}</strong></div>
      <div><span>Raw Chunks</span><strong>${escapeHtml(thread.rawChunkCount || rawChunks.length || 0)}</strong></div>
      <div><span>Freshness</span><strong>${escapeHtml(thread.freshness?.rawStale ? "stale" : "fresh")}</strong></div>
      <div><span>Created</span><strong>${escapeHtml(formatTime(thread.createdAt))}</strong></div>
      <div><span>Updated</span><strong>${escapeHtml(formatTime(thread.updatedAt))}</strong></div>
      <div><span>Last Raw</span><strong>${escapeHtml(formatTime(thread.latestRawTelemetryAt))}</strong></div>
      <div><span>Linked Job</span><strong>${escapeHtml(thread.linkedRunnerJobId || "none")}</strong></div>
    </section>

    <div class="detail-body">
      ${processedBlock(thread.processed)}
      ${linkedRunnerJobBlock(linkedRunnerJob)}
      ${localActivityBlock(latestActivity)}
      ${filesBlock(rawChunks)}
      ${rawTelemetryBlock({
        latestRawTelemetryAt: thread.latestRawTelemetryAt,
        rawChunkCount: thread.rawChunkCount,
        rawPayloadAvailable: rawChunks.length > 0,
        rawStale: thread.freshness?.rawStale
      }, rawChunks, "Local Raw Telemetry")}
    </div>
  `;
}

function renderOverviewDetail() {
  const activeJobs = state.jobs.filter((job) => job.status === "running");
  const staleJobs = state.jobs.filter((job) => job.rawTelemetry?.rawStale);
  const staleThreads = state.threads.filter((thread) => thread.freshness?.rawStale);
  const staleProcessed = [
    ...state.jobs.filter((job) => job.processed?.freshness?.processedStale || job.rawTelemetry?.rawAvailableButUnprocessed),
    ...state.threads.filter((thread) => thread.freshness?.processedStale)
  ];
  elements.detail.className = "detail";
  elements.detail.innerHTML = `
    <div class="detail-head">
      <div class="detail-title">
        <p class="eyebrow">Overview</p>
        <h2>Telemetry Freshness</h2>
        <p class="detail-subline">Runner jobs and local Codex activity are tracked as separate streams.</p>
      </div>
      <span class="status ${staleJobs.length || staleThreads.length ? "stuck" : "completed"}">${escapeHtml(staleJobs.length || staleThreads.length ? "Needs attention" : "Fresh")}</span>
    </div>
    <section class="detail-grid" aria-label="Overview metrics">
      <div><span>Active Jobs</span><strong>${escapeHtml(activeJobs.length)}</strong></div>
      <div><span>Local Threads</span><strong>${escapeHtml(state.threads.length)}</strong></div>
      <div><span>Stale Runner Raw</span><strong>${escapeHtml(staleJobs.length)}</strong></div>
      <div><span>Stale Local Raw</span><strong>${escapeHtml(staleThreads.length)}</strong></div>
      <div><span>Processed Streams</span><strong>${escapeHtml(state.processedStreams.length)}</strong></div>
      <div><span>Processed Behind</span><strong>${escapeHtml(staleProcessed.length)}</strong></div>
      <div><span>Memory Items</span><strong>${escapeHtml(state.memories.length)}</strong></div>
      <div><span>Processor</span><strong>${escapeHtml(state.processorStatus?.automatic?.paused ? "paused" : "automatic")}</strong></div>
    </section>
    <div class="detail-body">
      ${accountUsageBlock(state.processorStatus?.accountUsage)}
      ${processorStatusBlock(state.processorStatus)}
      ${memorySummaryBlock(state.memories)}
      <section class="block">
        <div class="block-head">
          <h3>Recent Mixed Activity</h3>
          <span>${escapeHtml(state.activity.length || "local")}</span>
        </div>
        ${state.activity.length ? eventsView(state.activity.slice(0, 20).map(activityFeedEvent), new Set(), "No activity yet.") : emptyState("No mixed activity", "Runner jobs and local threads will appear after ingest.", { compact: true })}
      </section>
    </div>
  `;
}

function renderMemoryDetail() {
  const memory = state.memories.find((item) => item.id === state.selectedMemoryId) || state.memories[0];
  elements.detail.className = "detail";
  if (!memory) {
    elements.detail.innerHTML = emptyState("No project memory", "Durable facts will appear after processing has enough evidence.");
    return;
  }
  elements.detail.innerHTML = `
    <div class="detail-head">
      <div class="detail-title">
        <p class="eyebrow">${escapeHtml(formatStatus(memory.memoryKind))}</p>
        <h2 title="${escapeAttribute(memory.title)}">${escapeHtml(memory.title)}</h2>
        <p class="detail-subline">${escapeHtml(memory.modelConfidence ? `${memory.modelConfidence} model confidence` : `${memory.evidenceStrength || "observed"} evidence`)}</p>
      </div>
      <span class="status ${memory.supersededBy ? "stopped" : "completed"}">${escapeHtml(memory.supersededBy ? "Superseded" : "Active")}</span>
    </div>
    <section class="activity-hero">
      <div class="activity-copy">
        <span class="section-label">Memory</span>
        <p>${escapeHtml(memory.body)}</p>
      </div>
      <div class="progress-readout">
        <strong>${escapeHtml(memory.evidence?.length || 0)}</strong>
        <span>evidence pointers</span>
      </div>
      <div class="progress large"><span style="width: ${memory.supersededBy ? 45 : 100}%"></span></div>
    </section>
    <div class="detail-body">
      <section class="block">
        <div class="block-head">
          <h3>Evidence</h3>
          <span>${escapeHtml(memory.evidenceStrength || "observed")}</span>
        </div>
        ${memory.evidence?.length ? eventsView(memory.evidence.map(memoryEvidenceEvent), new Set(), "No evidence pointers.") : emptyState("No evidence", "This memory item has no stored evidence pointers.", { compact: true })}
      </section>
    </div>
  `;
}

function renderProcessorDetail() {
  const status = state.processorStatus;
  elements.detail.className = "detail";
  if (!status) {
    elements.detail.innerHTML = emptyState("No processor status", "Processor status will appear after dashboard processing is configured.");
    return;
  }
  const cursor = status.cursor || {};
  const lease = status.lease || {};
  const lastRun = status.lastRun || {};
  elements.detail.innerHTML = `
    <div class="detail-head">
      <div class="detail-title">
        <p class="eyebrow">Processor Status</p>
        <h2>${escapeHtml(status.projectSlug || "Project")}</h2>
        <p class="detail-subline">${escapeHtml(status.automatic?.mode || "wake on ingest or local loop")}</p>
      </div>
      <span class="status ${lease.expired || !lease.ownerId ? "unknown" : "running"}">${escapeHtml(lease.ownerId ? "Lease observed" : "No active lease")}</span>
    </div>
    <section class="detail-grid" aria-label="Processor metrics">
      <div><span>Pending Streams</span><strong>${escapeHtml(cursor.pendingStreamCount ?? "unknown")}</strong></div>
      <div><span>Raw Cursor</span><strong>${escapeHtml(cursor.latestRawSequence ?? "unknown")}</strong></div>
      <div><span>Processed Cursor</span><strong>${escapeHtml(cursor.latestProcessedSequence ?? "unknown")}</strong></div>
      <div><span>Model Mode</span><strong>${escapeHtml(status.model?.mode || "deterministic-only")}</strong></div>
      <div><span>Lease Owner</span><strong>${escapeHtml(lease.ownerId || "none")}</strong></div>
      <div><span>Lease Expiry</span><strong>${escapeHtml(formatTime(lease.expiresAt))}</strong></div>
      <div><span>Last Run</span><strong>${escapeHtml(lastRun.status || "none")}</strong></div>
      <div><span>Last Error</span><strong>${escapeHtml(lastRun.errors?.[0] || "none")}</strong></div>
    </section>
    <div class="detail-body">
      ${accountUsageBlock(status.accountUsage)}
      ${processorStatusBlock(status)}
    </div>
  `;
}

function spendBlock(spend) {
  if (!spend || typeof spend !== "object") {
    return emptyPanel("Spend", "No spend telemetry has arrived yet.");
  }
  const total = spend.totalOperationalCostUsd ?? spend.totalEstimatedCostUsd;
  return `
    <section class="block spend-block">
      <div class="block-head">
        <h3>Spend</h3>
        <span>${escapeHtml(formatSpendSource(spend))}</span>
      </div>
      <div class="spend-grid">
        <div>
          <span>Weekly Codex Budget</span>
          <strong>${escapeHtml(formatUsd(spend.codexWeeklyBudgetUsd))}</strong>
          <small>${escapeHtml(formatSeatLine(spend))}</small>
        </div>
        <div>
          <span>Task Codex Allocation</span>
          <strong>${escapeHtml(formatUsd(spend.codexTaskAllocationUsd ?? spend.codexTokenCostUsd))}</strong>
          <small>${escapeHtml(formatAllocationShare(spend))}</small>
        </div>
        <div>
          <span>DigitalOcean</span>
          <strong>${escapeHtml(formatUsd(spend.digitalOceanCostUsd))}</strong>
          <small>${escapeHtml(formatMinutes(spend.elapsedMinutes))}</small>
        </div>
        <div>
          <span>Total Ops Estimate</span>
          <strong>${escapeHtml(formatUsd(total))}</strong>
          <small>${escapeHtml(formatRemaining(spend))}</small>
        </div>
      </div>
    </section>
  `;
}

function processedBlock(processed) {
  if (!processed) {
    return emptyPanel("Processed Summary", "No processed read model has been built for this stream yet.");
  }
  const blockers = Array.isArray(processed.blockers) ? processed.blockers : [];
  const files = Array.isArray(processed.files) ? processed.files : [];
  return `
    <section class="block processed-block">
      <div class="block-head">
        <h3>Processed Summary</h3>
        <span>${escapeHtml(`through ${processed.processedThroughSequence || 0}`)}</span>
      </div>
      <div class="processed-summary">
        <p>${escapeHtml(processed.summary || "No processed summary available.")}</p>
        ${processed.nextAction ? `<strong>${escapeHtml(processed.nextAction)}</strong>` : ""}
        <small>${escapeHtml(`Calculated ${formatTime(processed.processedAt)} / ${processed.deterministicVersion || "deterministic"}`)}</small>
      </div>
      <div class="raw-summary">
        <div><span>Status</span><strong>${escapeHtml(formatStatus(processed.status))}</strong></div>
        <div><span>Blockers</span><strong>${escapeHtml(blockers.length)}</strong></div>
        <div><span>Files</span><strong>${escapeHtml(files.length)}</strong></div>
        <div><span>Tokens</span><strong>${escapeHtml(formatTokens(processed.tokenUsage))}</strong></div>
      </div>
      ${blockers.length ? eventsView(blockers.slice(-6).map(blockerEvent), new Set(), "No blocker signals extracted.") : ""}
    </section>
  `;
}

function accountUsageBlock(usage) {
  const latest = usage?.latest;
  if (!latest) {
    return emptyPanel("Account Usage And Limits", "No Codex account status snapshot has arrived yet.");
  }
  const weekly = latest.weeklyRemaining || {};
  const rolling = latest.rolling5hRemaining || {};
  return `
    <section class="block usage-block">
      <div class="block-head">
        <h3>Account Usage And Limits</h3>
        <span>${escapeHtml(usage.label || "observed/estimated")}</span>
      </div>
      <div class="usage-grid">
        <div>
          <span>Weekly Remaining</span>
          <strong>${escapeHtml(formatLimitRemaining(weekly))}</strong>
          <small>${escapeHtml(formatReset(latest.reset?.weeklyResetAt))}</small>
        </div>
        <div>
          <span>5-hour Remaining</span>
          <strong>${escapeHtml(formatLimitRemaining(rolling))}</strong>
          <small>${escapeHtml(formatReset(latest.reset?.rolling5hResetAt))}</small>
        </div>
        <div>
          <span>Last Hour Tokens</span>
          <strong>${escapeHtml(formatNumber(usage.tokensLastHour))}</strong>
          <small>${escapeHtml(`${formatNumber(usage.tokenBurnRatePerHour)} / hour`)}</small>
        </div>
        <div>
          <span>Today / Week</span>
          <strong>${escapeHtml(`${formatNumber(usage.tokensToday)} / ${formatNumber(usage.tokensThisWeek)}`)}</strong>
          <small>${escapeHtml(formatLimitEta(usage.estimatedHoursUntilLimit))}</small>
        </div>
      </div>
    </section>
  `;
}

function processorStatusBlock(status) {
  if (!status) {
    return emptyPanel("Processor Status", "No processor status has been reported.");
  }
  const cursor = status.cursor || {};
  const lastRun = status.lastRun || {};
  const warnings = Array.isArray(status.warnings) ? status.warnings : [];
  return `
    <section class="block processor-block">
      <div class="block-head">
        <h3>Processor Status</h3>
        <span>${escapeHtml(status.automatic?.paused ? "paused" : "automatic")}</span>
      </div>
      <div class="raw-summary">
        <div><span>Pending</span><strong>${escapeHtml(cursor.pendingStreamCount ?? "unknown")}</strong></div>
        <div><span>Behind</span><strong>${escapeHtml(cursor.behindBySequence ?? "unknown")}</strong></div>
        <div><span>Last Run</span><strong>${escapeHtml(lastRun.status || "none")}</strong></div>
        <div><span>Model</span><strong>${escapeHtml(status.model?.mode || "deterministic-only")}</strong></div>
      </div>
      ${warnings.length ? eventsView(warnings.map(warningEvent), new Set(), "No processor warnings.") : ""}
    </section>
  `;
}

function memorySummaryBlock(memories) {
  const active = memories.filter((memory) => !memory.supersededBy);
  if (!active.length) {
    return emptyPanel("Project Memory", "No active memory items have been extracted yet.");
  }
  return `
    <section class="block memory-block">
      <div class="block-head">
        <h3>Project Memory</h3>
        <span>${escapeHtml(`${active.length} active`)}</span>
      </div>
      <div class="memory-list">
        ${active.slice(0, 6).map((memory) => `
          <div class="memory-card">
            <strong title="${escapeAttribute(memory.title)}">${escapeHtml(memory.title)}</strong>
            <p title="${escapeAttribute(memory.body)}">${escapeHtml(memory.body)}</p>
            <span>${escapeHtml(memory.modelConfidence ? `${memory.modelConfidence} model confidence` : `${memory.evidenceStrength || "observed"} evidence`)}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function goalsBlock(goals, subgoals, fallbackPercent) {
  const safeGoals = Array.isArray(goals) ? goals : [];
  const safeSubgoals = Array.isArray(subgoals) ? subgoals : [];
  if (!safeGoals.length) {
    return emptyPanel("Goals", "Structured contract goals have not arrived yet.");
  }
  const complete = safeGoals.filter((goal) => goal.state === "complete").length;
  const progress = safeGoals.length ? Math.round((complete / safeGoals.length) * 100) : fallbackPercent;
  const active = safeGoals.find((goal) => goal.state === "active");
  const blocked = safeGoals.filter((goal) => goal.state === "blocked");
  return `
    <section class="block goals-block">
      <div class="block-head">
        <h3>Contract Goals</h3>
        <span>${escapeHtml(`${complete}/${safeGoals.length} complete`)}</span>
      </div>
      <div class="goal-overview">
        <div>
          <strong>${escapeHtml(formatPercent(progress))}</strong>
          <span>goal progress</span>
        </div>
        <div>
          <strong>${escapeHtml(active?.label || "No active goal reported")}</strong>
          <span>active goal</span>
        </div>
        <div>
          <strong>${escapeHtml(blocked.length ? `${blocked.length} blocked` : "No blockers")}</strong>
          <span>goal blockers</span>
        </div>
      </div>
      <div class="goals-list">
        ${safeGoals.map((goal) => goalRow(goal, safeSubgoals.filter((subgoal) => subgoal.parentId === goal.id))).join("")}
      </div>
      ${safeSubgoals.some((subgoal) => !subgoal.parentId) ? `
        <div class="subgoal-orphans">
          <span class="section-label">Observed subgoals</span>
          ${safeSubgoals.filter((subgoal) => !subgoal.parentId).slice(0, 8).map((subgoal) => goalRow(subgoal, [], true)).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function goalRow(goal, subgoals = [], compact = false) {
  return `
    <div class="goal-row state-${escapeAttribute(goal.state || "unknown")} ${compact ? "compact" : ""}">
      <span class="goal-state-dot" aria-hidden="true"></span>
      <div>
        <strong title="${escapeAttribute(goal.label)}">${escapeHtml(goal.label)}</strong>
        <span>${escapeHtml(formatGoalMeta(goal))}</span>
        ${subgoals.length ? `<div class="nested-subgoals">${subgoals.slice(0, 4).map((subgoal) => goalRow(subgoal, [], true)).join("")}</div>` : ""}
      </div>
    </div>
  `;
}

function telemetryBlock(events, files, newEventIds) {
  const commands = events.filter((event) => ["command_started", "command_finished", "tool_call"].includes(event.type));
  const errors = events.filter((event) => event.type === "error" || event.severity === "error");
  const tabs = [
    ["activity", "Activity", events.length],
    ["files", "Files", files.length],
    ["commands", "Commands", commands.length],
    ["errors", "Errors", errors.length]
  ];
  const filter = tabs.some((tab) => tab[0] === state.eventFilter) ? state.eventFilter : "activity";
  state.eventFilter = filter;
  return `
    <section class="block telemetry-block">
      <div class="block-head">
        <h3>Live Transcript</h3>
        <span>${escapeHtml(events.length ? `${events.length} events` : "empty telemetry")}</span>
      </div>
      <div class="tabs" role="tablist" aria-label="Telemetry filters">
        ${tabs.map(([id, label, count]) => `
          <button class="${id === filter ? "active" : ""}" type="button" data-filter="${escapeAttribute(id)}">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(count)}</strong>
          </button>
        `).join("")}
      </div>
      ${filter === "files" ? filesView(files) : filter === "commands" ? eventsView(commands, newEventIds, "No command events yet.") : filter === "errors" ? eventsView(errors, newEventIds, "No errors observed.") : eventsView(events, newEventIds, "Structured activity has not arrived yet.")}
    </section>
  `;
}

function eventsView(events, newEventIds, emptyText) {
  if (!events.length) {
    return emptyState("No structured events", emptyText, { compact: true });
  }
  return `
    <div class="event-list">
      ${events.slice().reverse().map((event) => eventRow(event, newEventIds.has(event.id))).join("")}
    </div>
  `;
}

function eventRow(event, isNew) {
  const commandText = event.command?.text || "";
  const detail = event.detail || commandText || event.tool?.name || "";
  return `
    <div class="event-row severity-${escapeAttribute(event.severity || "info")} type-${escapeAttribute(event.type || "tool_call")} ${isNew ? "is-new" : ""}">
      <span class="event-rail" aria-hidden="true"></span>
      <div class="event-main">
        <div class="event-title-line">
          <strong>${escapeHtml(event.label || formatEventType(event.type))}</strong>
          <span>${escapeHtml(formatTime(event.timestamp))}</span>
        </div>
        ${event.filePath ? `<p class="event-path" title="${escapeAttribute(event.filePath)}">${escapeHtml(event.filePath)}</p>` : ""}
        ${detail ? `<p title="${escapeAttribute(detail)}">${escapeHtml(detail)}</p>` : ""}
        <div class="event-meta">
          <span>${escapeHtml(formatEventType(event.type))}</span>
          <span>${escapeHtml(formatEvidenceLabel(event.confidence))}</span>
          ${event.inferred ? "<span>inferred</span>" : ""}
        </div>
      </div>
    </div>
  `;
}

function filesView(files) {
  if (!files.length) {
    return emptyState("No file activity", "File reads and edits will appear after structured telemetry arrives.", { compact: true });
  }
  return `
    <div class="files-table" role="table" aria-label="Files touched">
      <div class="files-head" role="row">
        <span>Path</span>
        <span>Action</span>
        <span>Counts</span>
        <span>Seen</span>
      </div>
      ${files.map((file) => `
        <div class="file-row action-${escapeAttribute(file.latestAction || "read")}" role="row">
          <span class="file-path" title="${escapeAttribute(file.path)}">${escapeHtml(file.path)}</span>
          <span>${escapeHtml(formatFileAction(file.latestAction))}</span>
          <span>${escapeHtml(formatFileCounts(file))}</span>
          <span title="${escapeAttribute(file.source || "")}">${escapeHtml(formatTime(file.lastSeenAt))} / ${escapeHtml(formatEvidenceLabel(file.confidence || (file.source === "raw" ? "observed" : "low")))}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function historyBlock(history) {
  return `
    <section class="block">
      <div class="block-head">
        <h3>Observer History</h3>
        <span>${history.length}</span>
      </div>
      <div class="history">
        ${history.length ? history.map((item) => {
          const activity = item.summary?.currentActivity || "No activity summary";
          const percent = item.summary?.progressPercent == null ? "unknown" : formatPercent(item.summary.progressPercent);
          return `
            <div class="history-row">
              <span class="history-time">${escapeHtml(formatTime(item.receivedAt))}</span>
              <strong>${escapeHtml(percent)}</strong>
              <span class="history-activity" title="${escapeAttribute(activity)}">${escapeHtml(activity)}</span>
            </div>
          `;
        }).join("") : '<div class="muted padded">No durable summaries yet</div>'}
      </div>
    </section>
  `;
}

function rawTelemetryBlock(rawTelemetry, chunks, title = "Raw Telemetry") {
  const raw = rawTelemetry || {};
  const count = raw.rawChunkCount ?? chunks.length ?? 0;
  return `
    <section class="block raw-block">
      <div class="block-head">
        <h3>${escapeHtml(title)}</h3>
        <span>${escapeHtml(formatRawLine(raw) || "no raw chunks")}</span>
      </div>
      <div class="raw-summary">
        <div><span>Last Raw</span><strong>${escapeHtml(formatTime(raw.latestRawTelemetryAt))}</strong></div>
        <div><span>Chunks</span><strong>${escapeHtml(count)}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(raw.rawStatus || (raw.rawStale ? "stale" : "available"))}</strong></div>
        <div><span>Storage</span><strong>${escapeHtml(chunks.some((chunk) => chunk.storedInR2) ? "R2" : chunks.length ? "D1 fallback" : "none")}</strong></div>
      </div>
      ${chunks.length ? `
        <div class="raw-table" role="table" aria-label="Raw telemetry chunks">
          <div class="raw-row raw-head" role="row">
            <span>Seq</span>
            <span>Generated</span>
            <span>Bytes</span>
            <span>Hash</span>
            <span>Object</span>
          </div>
          ${chunks.slice(0, 12).map((chunk) => `
            <div class="raw-row" role="row">
              <span>${escapeHtml(chunk.sequence)}</span>
              <span>${escapeHtml(formatTime(chunk.generatedAt))}</span>
              <span>${escapeHtml(formatBytes(chunk.byteSize))}</span>
              <span title="${escapeAttribute(chunk.sha256)}">${escapeHtml((chunk.sha256 || "").slice(0, 12))}</span>
              <span title="${escapeAttribute(chunk.r2Key || "D1 inline fallback")}">${escapeHtml(chunk.r2Key || "inline")}</span>
            </div>
          `).join("")}
        </div>
      ` : emptyState("No raw chunks", "Raw telemetry metadata has not arrived yet.", { compact: true })}
    </section>
  `;
}

function linkedRunnerJobBlock(job) {
  if (!job) {
    return emptyPanel("Linked Runner Job", "No related remote runner job has been linked to this local thread.");
  }
  return `
    <section class="block">
      <div class="block-head">
        <h3>Linked Runner Job</h3>
        <span>${escapeHtml(formatStatus(job.status))}</span>
      </div>
      <div class="linked-job">
        <strong>${escapeHtml(job.id)}</strong>
        <span>${escapeHtml(job.currentActivity || "No runner activity reported")}</span>
        <small>${escapeHtml(formatTime(job.updatedAt))}</small>
      </div>
    </section>
  `;
}

function localActivityBlock(items) {
  if (!items.length) {
    return emptyPanel("Local Activity", "No prompt, message, or command snippets are available for this thread.");
  }
  return `
    <section class="block">
      <div class="block-head">
        <h3>Local Activity</h3>
        <span>${escapeHtml(items.length)}</span>
      </div>
      <div class="event-list">
        ${items.slice().reverse().map((item) => `
          <div class="event-row severity-info type-${escapeAttribute(item.type)}">
            <span class="event-rail" aria-hidden="true"></span>
            <div class="event-main">
              <div class="event-title-line">
                <strong>${escapeHtml(formatStatus(item.type))}</strong>
                <span>local</span>
              </div>
              <p title="${escapeAttribute(item.text || "")}">${escapeHtml(item.text || "No detail")}</p>
            </div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function filesBlock(chunks) {
  const files = [];
  for (const chunk of chunks) {
    const preview = chunk.inlinePreview || {};
    for (const file of preview.files || []) {
      const value = typeof file === "string" ? { path: file } : file;
      if (value?.path) {
        files.push({
          path: value.path,
          latestAction: value.status || value.latestAction || "observed",
          readCount: 0,
          editCount: 0,
          createCount: 0,
          deleteCount: 0,
          patchCount: 0,
          lastSeenAt: chunk.generatedAt,
          confidence: "observed",
          source: "raw"
        });
      }
    }
  }
  if (!files.length) {
    return emptyPanel("Files", "No referenced or changed files were included in the latest local telemetry.");
  }
  return `
    <section class="block">
      <div class="block-head">
        <h3>Files</h3>
        <span>${escapeHtml(files.length)}</span>
      </div>
      ${filesView(files.slice(0, 80))}
    </section>
  `;
}

function logBlock(logTail) {
  const log = logTail || "";
  const lineCount = log ? log.split(/\r?\n/).filter(Boolean).length : 0;
  return `
    <details class="log-details">
      <summary>
        <span>Inspect raw log tail</span>
        <span>${escapeHtml(lineCount ? lineCount + " lines" : "No log tail")}</span>
      </summary>
      <pre>${escapeHtml(log || "No log tail was included in the latest update.")}</pre>
    </details>
  `;
}

function emptyPanel(title, message) {
  return `
    <section class="block">
      <div class="block-head">
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${emptyState(title, message, { compact: true })}
    </section>
  `;
}

function renderError(error, scope = "detail") {
  const message = error.message || String(error);
  elements.detail.className = "detail";
  if (scope === "list") {
    elements.jobs.innerHTML = errorState(message, "Unable to load jobs");
  }
  elements.detail.innerHTML = errorState(message, "Dashboard request failed");
}

function setRefreshing(value) {
  elements.refreshButton.setAttribute("aria-busy", value ? "true" : "false");
  elements.refreshButton.classList.toggle("is-loading", value);
  elements.refreshButton.disabled = value && !state.jobs.length;
}

function listSkeleton() {
  return Array.from({ length: 6 }, () => `
    <div class="job-row skeleton-row" aria-hidden="true">
      <span class="skeleton-line w-80"></span>
      <span class="skeleton-line w-50"></span>
      <span class="skeleton-line w-95"></span>
      <span class="skeleton-line w-70"></span>
    </div>
  `).join("");
}

function detailSkeleton() {
  return `
    <div class="detail-skeleton" aria-label="Loading job detail">
      <div class="skeleton-panel head">
        <span class="skeleton-line w-30"></span>
        <span class="skeleton-line w-70"></span>
        <span class="skeleton-line w-45"></span>
      </div>
      <div class="skeleton-panel hero">
        <span class="skeleton-line w-20"></span>
        <span class="skeleton-line w-90"></span>
        <span class="skeleton-line w-60"></span>
      </div>
      <div class="skeleton-grid">
        ${Array.from({ length: 8 }, () => '<span class="skeleton-cell"></span>').join("")}
      </div>
    </div>
  `;
}

function emptyDetail() {
  return emptyState("Select a job", "Job details will appear here.");
}

function emptyState(title, message, options = {}) {
  return `
    <div class="empty-state ${options.compact ? "compact" : ""}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function errorState(message, title) {
  return `
    <div class="error-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function normalizedTelemetry(job) {
  const telemetry = job.telemetry && typeof job.telemetry === "object" ? job.telemetry : null;
  if (!telemetry) {
    return null;
  }
  return {
    ...telemetry,
    events: Array.isArray(telemetry.events) ? telemetry.events : [],
    files: Array.isArray(telemetry.files) ? telemetry.files : [],
    goals: Array.isArray(telemetry.goals) ? telemetry.goals : [],
    subgoals: Array.isArray(telemetry.subgoals) ? telemetry.subgoals : [],
    spend: telemetry.spend || job.summary?.cost || null
  };
}

function aggregateFilesFromEvents(events) {
  const files = new Map();
  for (const event of events) {
    if (!event.filePath) {
      continue;
    }
    const action = fileActionForEvent(event.type);
    if (!action) {
      continue;
    }
    const existing = files.get(event.filePath) || {
      path: event.filePath,
      latestAction: action,
      readCount: 0,
      editCount: 0,
      createCount: 0,
      deleteCount: 0,
      patchCount: 0,
      lastSeenAt: null,
      confidence: event.confidence || "low",
      source: event.source || "events"
    };
    existing.latestAction = action;
    existing.lastSeenAt = event.timestamp || existing.lastSeenAt;
    if (action === "read") {
      existing.readCount += 1;
    } else if (action === "edited") {
      existing.editCount += 1;
    } else if (action === "created") {
      existing.createCount += 1;
    } else if (action === "deleted") {
      existing.deleteCount += 1;
    } else if (action === "patched") {
      existing.patchCount += 1;
    }
    files.set(event.filePath, existing);
  }
  return Array.from(files.values());
}

function fileActionForEvent(type) {
  if (type === "file_read") return "read";
  if (type === "file_edited") return "edited";
  if (type === "file_created") return "created";
  if (type === "file_deleted") return "deleted";
  if (type === "patch_applied") return "patched";
  return null;
}

function unseenEventIds(jobId, events) {
  const seen = state.seenEvents.get(jobId) || new Set();
  return new Set(events.map((event) => event.id).filter((id) => id && !seen.has(id)));
}

function markEventsSeen(jobId, events) {
  const seen = state.seenEvents.get(jobId) || new Set();
  for (const event of events) {
    if (event.id) {
      seen.add(event.id);
    }
  }
  state.seenEvents.set(jobId, seen);
}

function formatCost(cost) {
  return formatUsd(cost?.totalOperationalCostUsd ?? cost?.totalEstimatedCostUsd);
}

function formatSourceKind(value) {
  if (value === "codex-cli-thread") return "CLI thread";
  if (value === "codex-ide-thread") return "IDE thread";
  if (value === "local-workspace") return "Workspace telemetry";
  if (value === "codespace-worker") return "Codespace worker";
  if (value === "runner-job") return "Runner job";
  return formatStatus(value || "local thread");
}

function formatRawLine(raw) {
  if (!raw) {
    return "";
  }
  const count = raw.rawChunkCount;
  const parts = [
    typeof count === "number" ? `${count} raw` : "",
    raw.latestRawTelemetryAt ? formatTime(raw.latestRawTelemetryAt) : "",
    raw.rawStale ? "stale" : ""
  ].filter(Boolean);
  return parts.join(" / ");
}

function formatBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "unknown";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUsd(value) {
  return typeof value === "number" && Number.isFinite(value) ? "$" + value.toFixed(value < 0.01 ? 4 : 2) : "unknown";
}

function formatTokens(cost) {
  const tokens = cost?.totalTokens;
  return typeof tokens === "number" && Number.isFinite(tokens) ? new Intl.NumberFormat().format(tokens) : "unknown";
}

function formatMinutes(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(value < 10 ? 1 : 0) + " min" : "unknown";
}

function formatSeatLine(spend) {
  const seats = spend.codexSubscriptionSeatMultiplier || 1;
  const monthly = spend.codexSubscriptionMonthlyUsd;
  return monthly ? `${formatUsd(monthly)} monthly x ${seats}` : "subscription not configured";
}

function formatAllocationShare(spend) {
  const percent = spend.codexTaskAllocationPercent;
  const confidence = spend.codexAllocationConfidence || "unknown";
  return typeof percent === "number" ? `${percent.toFixed(percent < 1 ? 2 : 1)}% weekly / ${confidence}` : confidence;
}

function formatRemaining(spend) {
  return spend.codexRemainingWeeklyBudgetUsd == null ? "weekly remaining unknown" : `${formatUsd(spend.codexRemainingWeeklyBudgetUsd)} weekly remaining`;
}

function formatSpendSource(spend) {
  if (!spend || typeof spend !== "object") {
    return "missing spend";
  }
  return spend.codexAllocationConfidence || spend.confidence || "estimated";
}

function progressPercent(job) {
  const telemetry = normalizedTelemetry(job);
  const value = telemetry?.progress?.percent ?? job.summary?.progressPercent ?? job.progressPercent;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return job.status === "completed" ? 100 : 0;
  }
  return Math.max(0, Math.min(100, value));
}

function percentDisplay(job) {
  const telemetry = normalizedTelemetry(job);
  const value = telemetry?.progress?.percent ?? job.summary?.progressPercent ?? job.progressPercent;
  const confidence = telemetry?.progress?.confidence ?? job.summary?.progressConfidence ?? "";
  return typeof value === "number" && Number.isFinite(value) ? `${formatPercent(value)} ${confidence}`.trim() : "unknown";
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function formatEta(summary) {
  const min = summary?.etaMinutesMin;
  const max = summary?.etaMinutesMax;
  if (typeof min !== "number" && typeof max !== "number") {
    return "unknown";
  }
  if (min === max || typeof max !== "number") {
    return `${min} min`;
  }
  if (typeof min !== "number") {
    return `${max} min`;
  }
  return `${min}-${max} min`;
}

function formatTime(value) {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatRefreshTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatStatus(value) {
  const words = String(value || "unknown").replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function statusClass(value) {
  const normalized = String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || "unknown";
}

function detailSubline(job) {
  const parts = [
    job.sessionName ? `Session ${job.sessionName}` : "",
    job.remoteHost || "",
    job.updatedAt ? `Updated ${formatTime(job.updatedAt)}` : ""
  ].filter(Boolean);
  return parts.join(" / ") || "No session metadata";
}

function threadSubline(thread) {
  const parts = [
    thread.threadId ? `Thread ${thread.threadId}` : "",
    thread.latestRawTelemetryAt ? `Raw ${formatTime(thread.latestRawTelemetryAt)}` : "",
    thread.linkedRunnerJobId ? `Linked ${thread.linkedRunnerJobId}` : ""
  ].filter(Boolean);
  return parts.join(" / ") || "No local thread metadata";
}

function activityFeedEvent(item) {
  return {
    id: item.id,
    type: "status_changed",
    label: item.label || "Activity",
    detail: `${item.title || item.id}: ${item.processedSummary || item.activity || "No activity reported"}`,
    severity: item.rawChunkCount ? "info" : "warning",
    status: item.status,
    confidence: item.processedAt ? "observed" : "medium",
    source: item.type,
    timestamp: item.updatedAt
  };
}

function blockerEvent(blocker) {
  return {
    id: `${blocker.kind || "blocker"}:${blocker.observedAt || ""}:${blocker.message || ""}`,
    type: "error",
    label: formatStatus(blocker.kind || "Blocker"),
    detail: blocker.message || "Blocker signal extracted.",
    severity: "warning",
    confidence: "observed",
    source: blocker.source || "deterministic",
    timestamp: blocker.observedAt
  };
}

function warningEvent(warning) {
  return {
    id: warning.kind || warning.message,
    type: "status_changed",
    label: formatStatus(warning.kind || "Warning"),
    detail: warning.message || "",
    severity: warning.severity || "warning",
    confidence: "observed",
    source: "processor",
    timestamp: new Date().toISOString()
  };
}

function memoryEvidenceEvent(evidence) {
  return {
    id: `${evidence.sourceStreamId || ""}:${evidence.chunkId || ""}:${evidence.sequence || ""}`,
    type: "status_changed",
    label: evidence.sourceStreamId || "Evidence",
    detail: evidence.chunkId ? `Chunk ${evidence.chunkId}` : `Sequence ${evidence.sequence || "unknown"}`,
    severity: "info",
    confidence: evidence.evidenceStrength || "observed",
    source: "memory",
    timestamp: evidence.timestamp
  };
}

function formatGoalMeta(goal) {
  return [formatStatus(goal.state), `${goal.confidence || "low"} confidence`, goal.source || ""].filter(Boolean).join(" / ");
}

function formatEvidenceLabel(value) {
  return ["observed", "calculated", "extracted", "estimated"].includes(value) ? value : `${value || "low"} confidence`;
}

function formatProcessedLine(processed) {
  if (!processed?.processedAt) {
    return "";
  }
  const parts = [
    `processed ${formatTime(processed.processedAt)}`,
    processed.freshness?.processedStale ? "behind" : "",
    processed.modelVersion ? "model" : "deterministic"
  ].filter(Boolean);
  return parts.join(" / ");
}

function formatLimitRemaining(value) {
  if (!value || typeof value !== "object") {
    return "unknown";
  }
  const percent = value.percentRemaining;
  if (typeof percent === "number" && Number.isFinite(percent)) {
    return `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
  }
  const remaining = value.remainingTokens ?? value.remaining;
  return typeof remaining === "number" ? formatNumber(remaining) : "unknown";
}

function formatReset(value) {
  return value ? `resets ${formatTime(value)}` : "reset unknown";
}

function formatLimitEta(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(value < 10 ? 1 : 0)}h until limit` : "limit ETA unknown";
}

function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat().format(Math.round(value)) : "unknown";
}

function currentProjectSlug() {
  return state.jobs[0]?.projectSlug || state.threads[0]?.projectSlug || state.processedStreams[0]?.projectSlug || state.memories[0]?.projectSlug || "";
}

function formatEventType(value) {
  return formatStatus(String(value || "tool_call").replaceAll("_", " "));
}

function formatFileAction(value) {
  return formatStatus(value || "read");
}

function formatFileCounts(file) {
  return [
    file.readCount ? `r ${file.readCount}` : "",
    file.editCount ? `e ${file.editCount}` : "",
    file.createCount ? `c ${file.createCount}` : "",
    file.deleteCount ? `d ${file.deleteCount}` : "",
    file.patchCount ? `p ${file.patchCount}` : ""
  ].filter(Boolean).join(" / ") || "0";
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
