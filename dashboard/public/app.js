const tokenKey = "agent-runner-dashboard-token";
const state = {
  token: localStorage.getItem(tokenKey) || "",
  jobs: [],
  selectedId: null,
  detailJob: null,
  detailHistory: [],
  eventFilter: "activity",
  seenEvents: new Map(),
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
      state.detailJob = null;
      state.detailHistory = [];
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
    state.detailJob = data.job;
    state.detailHistory = data.history || [];
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
    const telemetry = normalizedTelemetry(job);
    const percent = progressPercent(job);
    const status = job.isStuck ? "stuck" : job.status || "unknown";
    const className = statusClass(status);
    const activity = telemetry?.currentActivity || job.summary?.currentActivity || job.currentActivity || "No activity reported";
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
          <span>${escapeHtml(formatSpendSource(telemetry?.spend || job.summary?.cost))}</span>
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
  const telemetry = normalizedTelemetry(job);
  const status = job.isStuck ? "stuck" : job.status || "unknown";
  const className = statusClass(status);
  const percent = progressPercent(job);
  const activity = telemetry?.currentActivity || summary.currentActivity || job.currentActivity || "No activity reported";
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
      ${spendBlock(spend)}
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
          <span>${escapeHtml(event.confidence || "low")} confidence</span>
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
          <span title="${escapeAttribute(file.source || "")}">${escapeHtml(formatTime(file.lastSeenAt))} / ${escapeHtml(file.confidence || "low")}</span>
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

function formatGoalMeta(goal) {
  return [formatStatus(goal.state), `${goal.confidence || "low"} confidence`, goal.source || ""].filter(Boolean).join(" / ");
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
