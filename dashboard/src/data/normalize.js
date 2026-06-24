export function normalizeLiveDashboardData(raw) {
  if (!raw) {
    return emptyLiveData();
  }
  const jobs = raw.jobs?.length
    ? raw.jobs.map((job, index) => normalizeJob(job, index, raw.selectedJobDetail)).filter(Boolean)
    : [];
  const processor = normalizeProcessor(raw.processorStatus);
  return {
    mode: "live",
    jobs,
    activity: raw.activity || [],
    processedStreams: raw.processedStreams || [],
    usage: normalizeUsage(raw.processorStatus, jobs[0]),
    cloud: normalizeCloud(raw.processorStatus),
    processor
  };
}

function emptyLiveData() {
  return {
    mode: "live",
    jobs: [],
    activity: [],
    processedStreams: [],
    usage: {
      allowancePercent: null,
      allowanceLabel: "No data",
      allowanceDetail: "Codex allowance not reported",
      tokenPulse: "No data",
      tokenPulseUnit: "No data yet",
      costToday: "No data",
      costDelta: neutralDelta("Unavailable"),
      spark: [22, 26, 25, 28, 27, 31, 29, 30],
      pulse: [24, 25, 25, 27, 26, 28, 27, 29],
      unavailable: true
    },
    cloud: {
      storage: "No data",
      storageDelta: neutralDelta("Unavailable"),
      snapshots: "No data",
      snapshotsDelta: neutralDelta("Unavailable"),
      runningPods: "No data",
      runningPodsDelta: neutralDelta("Unavailable"),
      podHours: "No data",
      podHoursDelta: neutralDelta("Unavailable"),
      totalSpend: "No data",
      spendDelta: neutralDelta("Unavailable"),
      spark: [28, 29, 28, 30, 29, 31, 30, 30],
      unavailable: true
    },
    processor: {
      mode: "Unavailable",
      selected: "No active lease",
      health: "No data",
      lease: "none",
      pendingStreams: "No data",
      behind: "No data",
      lastRun: "No data",
      unavailable: true
    }
  };
}

function normalizeJob(job, index, detailJob) {
  const source = detailJob?.id === job.id ? { ...job, ...detailJob } : job;
  const goals = jobGoals(source);
  const completion = completionPercent(source, goals);
  const status = displayStatus(source);
  return {
    id: source.id || `job-${index}`,
    shortId: shortId(source.id || source.taskId || `job-${index}`),
    title: jobTitle(source),
    branch: jobBranch(source),
    status,
    statusLabel: formatStatus(status),
    actionLabel: status === "completed" || status === "review" ? "Review" : "",
    actionTime: formatRelative(source.updatedAt || source.lastSeenAt),
    elapsed: elapsedText(source),
    eta: etaText(source),
    etaShort: etaText(source, { short: true }),
    completion,
    remaining: remainingGoals(goals),
    featured: index === 0,
    icon: iconForJob(source),
    currentSubgoal: currentSubgoal(source, goals),
    currentEta: etaText(source, { short: true }),
    goals,
    subgoals: jobSubgoals(source)
  };
}

function normalizeUsage(processorStatus, job) {
  const usage = processorStatus?.accountUsage;
  const weekly = usage?.weekly || usage?.latest?.weeklyRemaining || null;
  const percent = numberOrNull(weekly?.percentRemaining);
  const burn = usage?.burn?.lastHour?.tokens ? `${formatCompact(usage.burn.lastHour.tokens)}` : "No data";
  const jobCost = job?.processed?.cost || job?.telemetry?.spend || job?.summary?.cost || null;
  const costToday = numberOrNull(jobCost?.totalOperationalCostUsd ?? jobCost?.totalEstimatedCostUsd ?? jobCost?.codexCostUsd);
  return {
    allowancePercent: percent,
    allowanceLabel: percent === null ? "No data" : `${Math.round(percent)}%`,
    allowanceDetail: formatLimitTokens(weekly),
    tokenPulse: burn,
    tokenPulseUnit: usage?.burn?.lastHour?.tokens ? "tokens / hour" : "No data yet",
    costToday: formatUsd(costToday),
    costDelta: costToday === null ? neutralDelta("Unavailable") : neutralDelta("selected job"),
    spark: [28, 35, 31, 42, 38, 48, 43, 50, 47, 55, 51, 58],
    pulse: [31, 35, 34, 38, 42, 39, 47, 44, 51, 49, 54, 52],
    unavailable: percent === null && burn === "No data" && costToday === null
  };
}

function normalizeCloud(processorStatus) {
  const cloud = processorStatus?.cloudSummary;
  if (!cloud) return emptyLiveData().cloud;
  const storage = cloud.rawTelemetryStorage;
  const snapshots = cloud.snapshotStorage;
  const runningPods = cloud.runningPods;
  const costToday = cloud.estimatedCostToday;
  return {
    storage: storage ? formatBytes(storage.r2ByteSize ?? storage.byteSize) : "No data",
    storageDelta: sourceDelta(storage?.method),
    snapshots: snapshots?.available ? formatBytes(snapshots.byteSize) : "No data",
    snapshotsDelta: sourceDelta(snapshots?.method),
    runningPods: runningPods ? String(runningPods.count) : "No data",
    runningPodsDelta: sourceDelta(runningPods?.method),
    podHours: runningPods?.podHoursToday ? `${runningPods.podHoursToday} h` : "No data",
    podHoursDelta: sourceDelta(runningPods?.method),
    totalSpend: costToday?.available ? formatUsd(costToday.usd) : "No data",
    spendDelta: sourceDelta(costToday?.method),
    spark: [29, 31, 30, 33, 32, 35, 34, 38, 35, 39, 37, 41],
    unavailable: !storage && !snapshots?.available && !runningPods && !costToday?.available
  };
}

function normalizeProcessor(processorStatus) {
  const runtime = processorStatus?.runtime || {};
  const cursor = processorStatus?.cursor || {};
  return {
    mode: formatProcessorMode(runtime.mode),
    selected: friendlyProcessorName(runtime.selectedProcessorInstance),
    health: formatStatus(runtime.health || "No data"),
    lease: formatLeaseStatus(runtime.leaseStatus),
    pendingStreams: cursor.pendingStreamCount ?? runtime.pendingStreams ?? "No data",
    behind: cursor.behindBySequence !== undefined ? `${cursor.behindBySequence} seq` : "No data",
    lastRun: formatRelative(runtime.lastRunAt),
    unavailable: !processorStatus || Boolean(processorStatus.error)
  };
}

function jobGoals(job) {
  const candidates = [
    job?.telemetry?.goals,
    job?.summary?.goals,
    job?.statusJson?.goals,
    job?.processed?.metadata?.goals
  ];
  for (const candidate of candidates) {
    const goals = normalizeGoals(candidate);
    if (goals.length) return goals;
  }
  return [];
}

function jobSubgoals(job) {
  const candidates = [
    job?.telemetry?.subgoals,
    job?.summary?.subgoals,
    job?.statusJson?.subgoals,
    job?.processed?.metadata?.subgoals
  ];
  for (const candidate of candidates) {
    const goals = normalizeGoals(candidate);
    if (goals.length) return goals;
  }
  return [];
}

function normalizeGoals(value) {
  if (!Array.isArray(value)) return [];
  return value.map((goal, index) => {
    if (typeof goal === "string") {
      return { id: `goal-${index}`, label: goal, state: "pending", percent: null };
    }
    if (!goal || typeof goal !== "object") return null;
    const state = normalizeGoalState(goal.state || goal.status || goal.phase);
    const percent = numberOrNull(goal.percent ?? goal.progressPercent ?? goal.progress?.percent);
    return {
      id: String(goal.id || goal.key || `goal-${index}`),
      label: firstString([goal.label, goal.title, goal.name, goal.description]) || `Goal ${index + 1}`,
      state,
      percent: percent ?? (state === "complete" ? 100 : null)
    };
  }).filter(Boolean);
}

function completionPercent(job, goals) {
  const direct = numberOrNull(job?.telemetry?.progress?.percent ?? job?.summary?.progressPercent ?? job?.progressPercent);
  if (direct !== null) return clamp(direct, 0, 100);
  if (goals.length) {
    return Math.round((goals.filter((goal) => goal.state === "complete").length / goals.length) * 100);
  }
  if (job?.status === "completed") return 100;
  return null;
}

function remainingGoals(goals) {
  if (!goals.length) return null;
  return goals.filter((goal) => goal.state !== "complete").length;
}

function currentSubgoal(job, goals) {
  const subgoal = jobSubgoals(job).find((goal) => goal.state === "active") ||
    goals.find((goal) => goal.state === "active") ||
    goals.find((goal) => goal.state !== "complete");
  return subgoal?.label ||
    firstString([job?.processed?.latestActivity, job?.telemetry?.currentActivity, job?.summary?.currentActivity, job?.currentActivity]) ||
    "No current subgoal reported";
}

function jobTitle(job) {
  const human = firstString([
    job?.processed?.metadata?.sourceTitle,
    job?.sessionName,
    job?.summary?.title,
    job?.processed?.metadata?.sourceMetadata?.title
  ]);
  if (human && !looksLikeMachineId(human)) return humanizeIdentifier(human);
  const task = firstString([job?.taskId]);
  if (task && !looksLikeMachineId(task)) return humanizeIdentifier(task);
  const activity = firstString([job?.processed?.latestActivity, job?.summary?.currentActivity, job?.currentActivity]);
  if (activity && !looksLikeMachineId(activity)) return sentenceTitle(activity);
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

function iconForJob(job) {
  const text = `${jobTitle(job)} ${job?.projectSlug || ""}`.toLowerCase();
  if (text.includes("doc")) return "book";
  if (text.includes("processor")) return "cpu";
  if (text.includes("storage") || text.includes("cloud")) return "database";
  return "cube";
}

function displayStatus(job) {
  if (!job) return "unavailable";
  if (job.isStuck) return "stuck";
  return job.status || "unknown";
}

function elapsedText(job) {
  const start = Date.parse(job?.startedAt || "");
  const end = Date.parse(job?.finishedAt || job?.updatedAt || job?.lastSeenAt || "");
  if (!Number.isFinite(start)) return "No data";
  const minutes = Math.max(1, Math.round(((Number.isFinite(end) ? end : Date.now()) - start) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function etaText(job, options = {}) {
  const min = numberOrNull(job?.etaMinutesMin);
  const max = numberOrNull(job?.etaMinutesMax);
  if (min !== null && max !== null) return `${min}-${max}m`;
  if (min !== null) return options.short ? `${min}m` : `${min}m min`;
  return "No ETA";
}

function formatLimitTokens(weekly) {
  if (!weekly) return "Codex allowance not reported";
  const remaining = numberOrNull(weekly.remainingTokens ?? weekly.remaining);
  const limit = numberOrNull(weekly.limitTokens ?? weekly.limit);
  if (remaining === null || limit === null) return "Limit unavailable";
  return `${formatCompact(remaining)} / ${formatCompact(limit)} tokens`;
}

function formatRelative(value) {
  if (!value) return "No data";
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms)) return "No data";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function normalizeGoalState(value) {
  const state = String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (["complete", "completed", "done", "passed"].includes(state)) return "complete";
  if (["active", "in_progress", "running", "current"].includes(state)) return "active";
  if (["blocked", "failed"].includes(state)) return "blocked";
  if (["pending", "queued", "not_started", "todo"].includes(state)) return "pending";
  return state || "unknown";
}

function formatStatus(value) {
  return String(value || "Unavailable")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function neutralDelta(label) {
  return { label, tone: "neutral" };
}

function sourceDelta(value) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized || normalized === "unavailable" || normalized === "unknown") {
    return neutralDelta("Unavailable");
  }
  const labels = {
    d1_chunk_metadata_estimate: "indexed estimate",
    derived_from_running_jobs: "from running jobs",
    processed_job_cost_estimate: "processed estimate",
    measured: "measured",
    allocated: "allocated",
    estimated: "estimated"
  };
  return {
    label: labels[normalized] || humanizeIdentifier(normalized),
    tone: ["measured", "allocated"].includes(normalized) ? "positive" : "info"
  };
}

function formatProcessorMode(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Unavailable";
  if (/^(unavailable|unknown|none)$/i.test(normalized)) return "Unavailable";
  return formatStatus(normalized);
}

function formatLeaseStatus(value) {
  const normalized = String(value || "").trim();
  if (!normalized || /^(none|unknown|unavailable)$/i.test(normalized)) return "None";
  return formatStatus(normalized);
}

function friendlyProcessorName(value) {
  const text = String(value || "").trim();
  if (!text || /^(none|unknown|unavailable)$/i.test(text)) return "No active lease";
  return text.length > 34 ? `${text.slice(0, 31)}...` : text;
}

function firstString(values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function looksLikeMachineId(value) {
  return /^[a-z0-9:_-]{12,}$/i.test(String(value || "")) || String(value || "").includes(":");
}

function humanizeIdentifier(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sentenceTitle(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length > 58 ? `${text.slice(0, 55)}...` : text;
}

function shortId(value) {
  return String(value || "unknown").split(":").at(-1).slice(0, 7);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatCompact(value) {
  const number = numberOrNull(value);
  if (number === null) return "No data";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(Math.round(number));
}

function formatUsd(value) {
  const number = numberOrNull(value);
  return number === null ? "No data" : `$${number.toFixed(2)}`;
}

function formatBytes(value) {
  const bytes = numberOrNull(value);
  if (bytes === null) return "No data";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}
