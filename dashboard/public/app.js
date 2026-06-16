const tokenKey = "agent-runner-dashboard-token";
const state = {
  token: localStorage.getItem(tokenKey) || "",
  jobs: [],
  selectedId: null,
  loading: false
};

const elements = {
  refreshButton: document.querySelector("#refresh-button"),
  jobs: document.querySelector("#jobs"),
  detail: document.querySelector("#detail"),
  lastUpdated: document.querySelector("#last-updated"),
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
  try {
    const response = await api("/api/jobs");
    state.jobs = response.jobs || [];
    if (!state.selectedId && state.jobs[0]) {
      state.selectedId = state.jobs[0].id;
    }
    elements.lastUpdated.textContent = "Updated " + formatTime(new Date().toISOString());
    render();
    if (state.selectedId) {
      await loadDetail(state.selectedId);
    }
  } catch (error) {
    if (!options.quiet) {
      renderError(error);
    }
  } finally {
    state.loading = false;
  }
}

async function loadDetail(id) {
  state.selectedId = id;
  render();
  try {
    const data = await api("/api/jobs/" + encodeURIComponent(id));
    renderDetail(data.job, data.history || []);
  } catch (error) {
    renderError(error);
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
  if (!state.selectedId) {
    elements.detail.innerHTML = '<div class="empty-state">Select a job</div>';
  }
}

function renderMetrics() {
  elements.running.textContent = state.jobs.filter((job) => job.status === "running").length;
  elements.stuck.textContent = state.jobs.filter((job) => job.isStuck).length;
  elements.completed.textContent = state.jobs.filter((job) => job.status === "completed").length;
  elements.failed.textContent = state.jobs.filter((job) => job.status === "failed").length;
}

function renderJobs() {
  if (!state.jobs.length) {
    elements.jobs.innerHTML = '<div class="empty-state">No jobs yet</div>';
    return;
  }

  elements.jobs.innerHTML = state.jobs.map((job) => {
    const percent = progressPercent(job);
    const status = job.isStuck ? "stuck" : job.status || "unknown";
    return `
      <button class="job-row ${job.id === state.selectedId ? "active" : ""}" data-job-id="${escapeAttribute(job.id)}">
        <span class="job-title">
          <span class="project">${escapeHtml(job.projectSlug)}</span>
          <span class="status ${escapeAttribute(status)}">${escapeHtml(status)}</span>
        </span>
        <span class="task-id">${escapeHtml(job.taskId)}</span>
        <span class="activity">${escapeHtml(job.currentActivity || job.summary?.currentActivity || "")}</span>
        <span class="progress"><span style="width: ${percent}%"></span></span>
        <span class="time">${escapeHtml(formatTime(job.updatedAt))}</span>
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
  const percent = progressPercent(job);
  elements.detail.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="eyebrow">${escapeHtml(job.projectSlug)}</p>
        <h2>${escapeHtml(job.taskId)}</h2>
      </div>
      <span class="status ${escapeAttribute(status)}">${escapeHtml(status)}</span>
    </div>
    <div class="detail-grid">
      <div><span>Progress</span><strong>${percentDisplay(job)}</strong></div>
      <div><span>ETA</span><strong>${escapeHtml(formatEta(summary))}</strong></div>
      <div><span>Updated</span><strong>${escapeHtml(formatTime(job.updatedAt))}</strong></div>
      <div><span>Started</span><strong>${escapeHtml(formatTime(job.startedAt))}</strong></div>
      <div><span>Finished</span><strong>${escapeHtml(formatTime(job.finishedAt))}</strong></div>
      <div><span>Exit</span><strong>${job.exitCode ?? "n/a"}</strong></div>
      <div><span>Cost</span><strong>${escapeHtml(formatCost(summary.cost))}</strong></div>
      <div><span>Tokens</span><strong>${escapeHtml(formatTokens(summary.cost))}</strong></div>
    </div>
    <div class="detail-body">
      <section class="block">
        <h3>Current</h3>
        <p>${escapeHtml(summary.currentActivity || job.currentActivity || "")}</p>
        <div class="progress"><span style="width: ${percent}%"></span></div>
      </section>
      <div class="columns">
        ${listBlock("Completed", summary.completed)}
        ${listBlock("Remaining", summary.remaining)}
      </div>
      ${costBlock(summary.cost)}
      ${listBlock("Blockers", summary.blockers)}
      <section class="block">
        <h3>Recent Log Tail</h3>
        <pre>${escapeHtml(job.logTail || "")}</pre>
      </section>
      <section class="block">
        <h3>Observer History</h3>
        <div class="history">
          ${history.map((item) => `
            <div class="history-row">
              <span>${escapeHtml(formatTime(item.receivedAt))}</span>
              <strong>${escapeHtml(item.summary?.progressPercent == null ? "unknown" : item.summary.progressPercent + "%")}</strong>
            </div>
          `).join("") || '<div class="muted">No history yet</div>'}
        </div>
      </section>
    </div>
  `;
}

function costBlock(cost) {
  if (!cost || typeof cost !== "object") {
    return "";
  }
  return `
    <section class="block">
      <h3>Estimated Cost</h3>
      <div class="cost-grid">
        <div><span>DigitalOcean</span><strong>${escapeHtml(formatUsd(cost.digitalOceanCostUsd))}</strong></div>
        <div><span>Codex</span><strong>${escapeHtml(formatUsd(cost.codexTokenCostUsd))}</strong></div>
        <div><span>Total</span><strong>${escapeHtml(formatUsd(cost.totalEstimatedCostUsd))}</strong></div>
        <div><span>Elapsed</span><strong>${escapeHtml(formatMinutes(cost.elapsedMinutes))}</strong></div>
      </div>
    </section>
  `;
}

function listBlock(title, items) {
  const safeItems = Array.isArray(items) ? items : [];
  return `
    <section class="block">
      <h3>${escapeHtml(title)}</h3>
      <ul class="items">
        ${safeItems.length ? safeItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : '<li class="muted">None</li>'}
      </ul>
    </section>
  `;
}

function renderError(error) {
  elements.detail.innerHTML = `<div class="error-state">${escapeHtml(error.message || String(error))}</div>`;
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
  return typeof value === "number" && Number.isFinite(value) ? `${value}% ${job.summary?.progressConfidence || ""}`.trim() : "unknown";
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll(" ", "-");
}
