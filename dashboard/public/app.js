const tokenKey = "agent-runner-dashboard-token";
const state = {
  token: localStorage.getItem(tokenKey) || "",
  jobs: [],
  selectedId: null,
  loading: false,
  error: null,
  lastUpdatedAt: null
};

const elements = {
  refreshButton: document.querySelector("#refresh-button"),
  jobs: document.querySelector("#jobs"),
  detail: document.querySelector("#detail"),
  lastUpdated: document.querySelector("#last-updated"),
  jobCount: document.querySelector("#job-count"),
  running: document.querySelector("#metric-running"),
  stuck: document.querySelector("#metric-stuck"),
  completed: document.querySelector("#metric-completed"),
  failed: document.querySelector("#metric-failed")
};

elements.refreshButton.addEventListener("click", () => loadJobs());

setInterval(() => {
  if (!state.loading) {
    loadJobs({ quiet: true });
  }
}, 15000);

render();
loadJobs();

async function loadJobs(options = {}) {
  state.loading = true;
  state.error = null;
  setRefreshing(true);
  if (!options.quiet) {
    render();
  }

  try {
    const response = await api("/api/jobs");
    state.jobs = response.jobs || [];
    if (!state.jobs.some((job) => job.id === state.selectedId)) {
      state.selectedId = state.jobs[0]?.id || null;
    }
    state.lastUpdatedAt = new Date();
    render();
    if (state.selectedId) {
      await loadDetail(state.selectedId, { preserveList: true });
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
    renderDetail(data.job, data.history || []);
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
  renderMetrics();
  renderJobs();
  renderFreshness();
  if (!state.selectedId) {
    elements.detail.className = "detail";
    elements.detail.innerHTML = state.loading ? detailSkeleton() : emptyDetail();
  }
}

function renderMetrics() {
  elements.running.textContent = state.jobs.filter((job) => job.status === "running" && !job.isStuck).length;
  elements.stuck.textContent = state.jobs.filter((job) => job.isStuck).length;
  elements.completed.textContent = state.jobs.filter((job) => job.status === "completed").length;
  elements.failed.textContent = state.jobs.filter((job) => job.status === "failed").length;
  elements.jobCount.textContent = `${state.jobs.length} ${state.jobs.length === 1 ? "job" : "jobs"}`;
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
    const percent = progressPercent(job);
    const status = job.isStuck ? "stuck" : job.status || "unknown";
    const className = statusClass(status);
    const activity = job.summary?.currentActivity || job.currentActivity || "No activity reported";
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
      </button>
    `;
  }).join("");

  for (const row of elements.jobs.querySelectorAll("[data-job-id]")) {
    row.addEventListener("click", () => loadDetail(row.dataset.jobId));
  }
}

function renderDetail(job, history) {
  const summary = job.summary || {};
  const status = job.isStuck ? "stuck" : job.status || "unknown";
  const className = statusClass(status);
  const percent = progressPercent(job);
  const activity = summary.currentActivity || job.currentActivity || "No activity reported";
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
        <div><span>Cost</span><strong>${escapeHtml(formatCost(summary.cost))}</strong></div>
        <div><span>Tokens</span><strong>${escapeHtml(formatTokens(summary.cost))}</strong></div>
        <div><span>Started</span><strong>${escapeHtml(formatTime(job.startedAt))}</strong></div>
        <div><span>Finished</span><strong>${escapeHtml(formatTime(job.finishedAt))}</strong></div>
        <div><span>Exit</span><strong>${escapeHtml(job.exitCode ?? "n/a")}</strong></div>
        <div><span>Last Seen</span><strong>${escapeHtml(formatTime(job.lastSeenAt))}</strong></div>
    </section>

    <div class="detail-body">
      ${listBlock("Blockers", summary.blockers, { blocker: true })}

      <div class="columns">
        ${listBlock("Completed", summary.completed)}
        ${listBlock("Remaining", summary.remaining)}
      </div>

      ${costBlock(summary.cost)}
      ${historyBlock(history)}
      ${logBlock(job.logTail)}
    </div>
  `;
}

function costBlock(cost) {
  if (!cost || typeof cost !== "object") {
    return "";
  }
  return `
    <section class="block">
      <div class="block-head">
        <h3>Estimated Cost</h3>
      </div>
      <div class="cost-grid">
        <div><span>DigitalOcean</span><strong>${escapeHtml(formatUsd(cost.digitalOceanCostUsd))}</strong></div>
        <div><span>Codex</span><strong>${escapeHtml(formatUsd(cost.codexTokenCostUsd))}</strong></div>
        <div><span>Total</span><strong>${escapeHtml(formatUsd(cost.totalEstimatedCostUsd))}</strong></div>
        <div><span>Elapsed</span><strong>${escapeHtml(formatMinutes(cost.elapsedMinutes))}</strong></div>
      </div>
    </section>
  `;
}

function listBlock(title, items, options = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const emptyText = options.blocker ? "No blockers reported" : "None";
  const count = `${safeItems.length} ${safeItems.length === 1 ? "item" : "items"}`;
  const highlight = options.blocker && safeItems.length;
  return `
    <section class="block ${highlight ? "blockers-block" : ""}">
      <div class="block-head">
        <h3>${escapeHtml(title)}</h3>
        <span>${escapeHtml(count)}</span>
      </div>
      <ul class="items">
        ${safeItems.length ? safeItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : `<li class="muted">${escapeHtml(emptyText)}</li>`}
      </ul>
    </section>
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
        }).join("") : '<div class="muted">No history yet</div>'}
      </div>
    </section>
  `;
}

function logBlock(logTail) {
  const log = logTail || "";
  const lineCount = log ? log.split(/\r?\n/).filter(Boolean).length : 0;
  return `
    <details class="log-details">
      <summary>
        <span>Inspect log tail</span>
        <span>${escapeHtml(lineCount ? lineCount + " lines" : "No log tail")}</span>
      </summary>
      <pre>${escapeHtml(log || "No log tail was included in the latest update.")}</pre>
    </details>
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

function formatCost(cost) {
  return formatUsd(cost?.totalEstimatedCostUsd);
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

function progressPercent(job) {
  const value = job.summary?.progressPercent ?? job.progressPercent;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return job.status === "completed" ? 100 : 0;
  }
  return Math.max(0, Math.min(100, value));
}

function percentDisplay(job) {
  const value = job.summary?.progressPercent ?? job.progressPercent;
  return typeof value === "number" && Number.isFinite(value) ? `${formatPercent(value)} ${job.summary?.progressConfidence || ""}`.trim() : "unknown";
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

function formatBytes(chars) {
  if (chars < 1000) {
    return `${chars} chars`;
  }
  return `${(chars / 1000).toFixed(chars < 10000 ? 1 : 0)}k chars`;
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
