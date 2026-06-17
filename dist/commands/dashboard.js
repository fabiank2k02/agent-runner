import { telemetryRuntimeSource } from "../dashboard-telemetry.js";
import { joinRemotePath } from "../quote.js";
import { quoteRemotePath, shellQuote } from "../quote.js";
const DASHBOARD_LIVE_INTERVAL_SECONDS = 60;
const DASHBOARD_LAUNCH_TIMEOUT_MS = 90_000;
const DASHBOARD_LAUNCH_POLL_MS = 3_000;
export class DashboardLaunchError extends Error {
    constructor(message) {
        super(message);
        this.name = "DashboardLaunchError";
    }
}
export function assertDashboardLaunchConfig(context) {
    const { config } = context;
    if (!config.dashboard.enabled) {
        throw new DashboardLaunchError("Dashboard reporting is required, but dashboard.enabled resolved to false.");
    }
    if (!config.dashboard.endpoint) {
        throw new DashboardLaunchError("Dashboard reporting is required, but AGENT_RUNNER_DASHBOARD_ENDPOINT is not set.");
    }
    if (!config.dashboard.token) {
        throw new DashboardLaunchError(`Dashboard reporting is required, but ${config.dashboard.tokenEnv} is not set.`);
    }
}
export async function startDashboardObserver(context, task) {
    const { config, layout, remote } = context;
    assertDashboardLaunchConfig(context);
    const observerSession = observerSessionName(layout.projectSlug, task.taskId);
    const observerDir = joinRemotePath(layout.remoteRoot, "observer", layout.projectSlug, task.taskId);
    const codexHome = joinRemotePath(observerDir, "codex-home");
    const summaryFile = `${layout.remoteProjectLogDir}/${task.taskId}.summary.json`;
    const observerLogFile = `${layout.remoteProjectLogDir}/${task.taskId}.observer.log`;
    const observerScriptFile = `${layout.remoteProjectLogDir}/${task.taskId}.observer.mjs`;
    await remote.run(`mkdir -p ${quoteRemotePath(observerDir)} ${quoteRemotePath(codexHome)} ${quoteRemotePath(layout.remoteProjectLogDir)}`);
    await remote.run(`[ -f ${quoteRemotePath(layout.remoteCodexAuthFile)} ] && cp ${quoteRemotePath(layout.remoteCodexAuthFile)} ${quoteRemotePath(joinRemotePath(codexHome, "auth.json"))} && chmod 600 ${quoteRemotePath(joinRemotePath(codexHome, "auth.json"))} || true`);
    await remote.writeText(observerScriptFile, buildObserverScript(context, task, observerSession, codexHome, summaryFile), "700");
    await remote.run(`tmux new-session -d -s ${shellQuote(observerSession)} ${shellQuote(`PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH" node ${quoteRemotePath(observerScriptFile)} >> ${quoteRemotePath(observerLogFile)} 2>&1`)}`);
    try {
        await waitForDashboardJob(config.dashboard.endpoint, config.dashboard.token, `${layout.projectSlug}:${task.taskId}`);
    }
    catch (error) {
        await remote.run(`tmux kill-session -t ${shellQuote(observerSession)} 2>/dev/null || true`);
        throw new DashboardLaunchError(`Dashboard observer did not publish verified telemetry for ${layout.projectSlug}:${task.taskId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
        enabled: true,
        sessionName: observerSession,
        summaryFile,
        logFile: observerLogFile,
        verified: true
    };
}
export function dashboardJobsUrl(endpoint) {
    const url = new URL(endpoint);
    url.pathname = url.pathname.replace(/\/api\/ingest\/?$/u, "/api/jobs");
    if (!url.pathname.endsWith("/api/jobs")) {
        url.pathname = "/api/jobs";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
}
async function waitForDashboardJob(endpoint, token, jobId) {
    const url = dashboardJobsUrl(endpoint);
    const deadline = Date.now() + DASHBOARD_LAUNCH_TIMEOUT_MS;
    let lastError = "";
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, {
                headers: {
                    authorization: `Bearer ${token}`
                }
            });
            const body = (await response.json().catch(() => ({})));
            if (!response.ok) {
                lastError = body?.error || response.statusText;
            }
            else if (Array.isArray(body.jobs) && body.jobs.some((job) => job.id === jobId)) {
                return;
            }
            else {
                lastError = `job ${jobId} was not present in GET /api/jobs`;
            }
        }
        catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, DASHBOARD_LAUNCH_POLL_MS));
    }
    throw new Error(lastError || "timed out waiting for GET /api/jobs");
}
function observerSessionName(projectSlug, taskId) {
    return `agent-runner-${projectSlug}-observer-${taskId}`.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 180);
}
function buildObserverScript(context, task, observerSession, codexHome, summaryFile) {
    const config = {
        endpoint: context.config.dashboard.endpoint,
        token: context.config.dashboard.token,
        intervalSeconds: context.config.dashboard.intervalSeconds,
        liveIntervalSeconds: DASHBOARD_LIVE_INTERVAL_SECONDS,
        model: context.config.dashboard.model,
        reasoningEffort: context.config.dashboard.reasoningEffort,
        maxLogLines: context.config.dashboard.maxLogLines,
        costs: context.config.dashboard.costs,
        projectSlug: context.layout.projectSlug,
        remoteHost: context.config.remote.host,
        taskId: task.taskId,
        taskSessionName: task.sessionName,
        observerSession,
        promptFile: task.promptFile,
        statusFile: task.statusFile,
        logFile: task.logFile,
        summaryFile,
        codexHome
    };
    return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const config = ${JSON.stringify(config, null, 2)};
for (const key of ["promptFile", "statusFile", "logFile", "summaryFile", "codexHome"]) {
  config[key] = expandHome(config[key]);
}
const hostPath = [
  path.join(process.env.HOME || "", ".local/bin"),
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  process.env.PATH || ""
].filter(Boolean).join(":");
const terminalStatuses = new Set(["completed", "failed", "stopped"]);

${telemetryRuntimeSource()}

function expandHome(value) {
  if (value === "~") {
    return process.env.HOME || value;
  }
  if (typeof value === "string" && value.startsWith("~/")) {
    return path.join(process.env.HOME || "", value.slice(2));
  }
  return value;
}

function clip(value, maxChars) {
  if (!value || value.length <= maxChars) {
    return value || "";
  }
  return value.slice(0, Math.floor(maxChars / 2)) + "\\n...[truncated]...\\n" + value.slice(-Math.floor(maxChars / 2));
}

function readText(file, fallback = "") {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

function readJson(file) {
  try {
    return JSON.parse(readText(file, "{}"));
  } catch {
    return {};
  }
}

function tailLines(file, maxLines) {
  const raw = readText(file);
  if (!raw) {
    return "";
  }
  return raw.split(/\\r?\\n/u).slice(-maxLines).join("\\n");
}

function buildFallbackSummary(status, logTail, prompt = "", events = []) {
  const state = typeof status.status === "string" ? status.status : "unknown";
  const goals = deriveGoalsFromPrompt(prompt).map((goal) => ({
    ...goal,
    state: state === "completed" ? "complete" : goal.state
  }));
  return normalizeSummary({
    currentActivity:
      state === "completed"
        ? "Task completed."
        : state === "failed"
          ? "Task failed."
          : currentActivityFromEvents(events, "Task is running; no observer summary was available yet."),
    completed: state === "completed" ? ["Remote Codex task completed"] : [],
    remaining: terminalStatuses.has(state) ? [] : ["Wait for more task output"],
    blockers: state === "failed" ? ["Remote Codex task exited with a failure status"] : [],
    isStuck: false,
    progressPercent: state === "completed" ? 100 : null,
    progressConfidence: state === "completed" ? "high" : "low",
    etaMinutesMin: state === "running" ? 1 : terminalStatuses.has(state) ? 0 : null,
    etaMinutesMax: state === "running" ? 20 : terminalStatuses.has(state) ? 0 : null,
    etaConfidence: terminalStatuses.has(state) ? "high" : "low",
    goals,
    subgoals: deriveSubgoalsFromEvents(events)
  });
}

function observerPrompt(prompt, status, logTail) {
  return [
    "You are a silent progress observer for a separate Codex job.",
    "Do not suggest actions. Do not edit files. Return only compact JSON matching this schema:",
    JSON.stringify({
      currentActivity: "string",
      completed: ["string"],
      remaining: ["string"],
      blockers: ["string"],
      isStuck: false,
      progressPercent: null,
      progressConfidence: "low|medium|high",
      etaMinutesMin: null,
      etaMinutesMax: null,
      etaConfidence: "low|medium|high",
      goals: [
        {
          id: "stable-id",
          label: "top-level contract goal",
          state: "not_started|active|complete|blocked|unknown",
          confidence: "low|medium|high",
          source: "prompt|agent_plan|events|summary"
        }
      ],
      subgoals: [
        {
          id: "stable-id",
          parentId: "optional parent goal id",
          label: "observed current subgoal",
          state: "not_started|active|complete|blocked|unknown",
          confidence: "low|medium|high",
          source: "prompt|agent_plan|events|summary"
        }
      ]
    }),
    "Use null for unknown numeric estimates. Keep arrays short. Estimate ETA when there is enough signal from status and logs.",
    "Derive goals from the initial prompt/contract, then update goal states from status, agent plans, and observed events.",
    "Keep goals and subgoals compact. Do not include bulky evidence text.",
    "Do not estimate cost; the runner calculates cost separately.",
    "",
    "Initial prompt/contract:",
    clip(prompt, 10000),
    "",
    "Latest status JSON:",
    JSON.stringify(status),
    "",
    "Recent Codex JSONL/log tail:",
    clip(logTail, 30000)
  ].join("\\n");
}

function runCodexSummary(prompt) {
  const args = [
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ignore-rules",
    "-c",
    'approval_policy="never"',
    "-c",
    "model_reasoning_effort=" + JSON.stringify(config.reasoningEffort)
  ];
  if (config.model) {
    args.push("--model", config.model);
  }
  args.push(prompt);

  const result = spawnSync("codex", args, {
    cwd: path.dirname(config.summaryFile),
    env: {
      ...process.env,
      CODEX_HOME: config.codexHome,
      PATH: hostPath
    },
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8
  });

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || "codex observer summary failed");
  }

  let message = "";
  for (const line of result.stdout.split(/\\r?\\n/u)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
        message = event.item.text;
      }
    } catch {
      message = line;
    }
  }

  const parsed = parseJsonFromText(message || result.stdout);
  return normalizeSummary(parsed);
}

function parseJsonFromText(text) {
  const fence = String.fromCharCode(96).repeat(3);
  const fenced = text.match(new RegExp(fence + "(?:json)?\\\\s*([\\\\s\\\\S]*?)" + fence, "u"));
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate.trim()) {
    throw new Error("observer summary did not contain JSON");
  }
  return JSON.parse(candidate);
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, 12) : [];
}

function normalizeConfidence(value) {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeGoalState(value) {
  return ["not_started", "active", "complete", "blocked", "unknown"].includes(value) ? value : "unknown";
}

function normalizeGoals(value, fallback = []) {
  const goals = Array.isArray(value) ? value : fallback;
  return goals
    .filter((item) => item && typeof item === "object" && typeof item.label === "string")
    .slice(0, 16)
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id.slice(0, 80) : stableId("goal", item.label),
      label: item.label.slice(0, 160),
      state: normalizeGoalState(item.state),
      confidence: normalizeConfidence(item.confidence),
      source: typeof item.source === "string" && item.source ? item.source.slice(0, 80) : "summary"
    }));
}

function normalizeSubgoals(value, fallback = []) {
  return normalizeGoals(value, fallback).map((item, index) => {
    const original = Array.isArray(value) ? value[index] : null;
    return {
      ...item,
      parentId: typeof original?.parentId === "string" && original.parentId ? original.parentId.slice(0, 80) : undefined
    };
  });
}

function normalizeNullableNumber(value, min = -Infinity, max = Infinity) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(min, Math.min(max, numeric));
}

function normalizeSummary(value) {
  const summary = typeof value === "object" && value !== null ? value : {};
  return {
    currentActivity: typeof summary.currentActivity === "string" ? summary.currentActivity.slice(0, 500) : "",
    completed: normalizeStringArray(summary.completed),
    remaining: normalizeStringArray(summary.remaining),
    blockers: normalizeStringArray(summary.blockers),
    isStuck: Boolean(summary.isStuck),
    progressPercent: normalizeNullableNumber(summary.progressPercent, 0, 100),
    progressConfidence: normalizeConfidence(summary.progressConfidence),
    etaMinutesMin: normalizeNullableNumber(summary.etaMinutesMin, 0),
    etaMinutesMax: normalizeNullableNumber(summary.etaMinutesMax, 0),
    etaConfidence: normalizeConfidence(summary.etaConfidence),
    goals: normalizeGoals(summary.goals),
    subgoals: normalizeSubgoals(summary.subgoals),
    cost: normalizeCost(summary.cost)
  };
}

function normalizeCost(value) {
  const cost = typeof value === "object" && value !== null ? value : {};
  return {
    elapsedMinutes: normalizeNullableNumber(cost.elapsedMinutes, 0),
    digitalOceanHourlyUsd: normalizeNullableNumber(cost.digitalOceanHourlyUsd, 0),
    digitalOceanCostUsd: normalizeNullableNumber(cost.digitalOceanCostUsd, 0),
    digitalOceanConfidence: typeof cost.digitalOceanConfidence === "string" ? cost.digitalOceanConfidence.slice(0, 60) : "unknown",
    codexSubscriptionMonthlyUsd: normalizeNullableNumber(cost.codexSubscriptionMonthlyUsd, 0),
    codexSubscriptionSeatMultiplier: normalizeNullableNumber(cost.codexSubscriptionSeatMultiplier, 0) ?? 1,
    codexWeeklyBudgetUsd: normalizeNullableNumber(cost.codexWeeklyBudgetUsd, 0),
    codexSubscriptionMonthlyTokens: normalizeNullableNumber(cost.codexSubscriptionMonthlyTokens, 0),
    codexWeeklyTokenAllowance: normalizeNullableNumber(cost.codexWeeklyTokenAllowance, 0),
    codexObservedWeeklyTokens: normalizeNullableNumber(cost.codexObservedWeeklyTokens, 0),
    codexTaskAllocationUsd: normalizeNullableNumber(cost.codexTaskAllocationUsd, 0),
    codexTokenCostUsd: normalizeNullableNumber(cost.codexTokenCostUsd, 0),
    codexTaskAllocationPercent: normalizeNullableNumber(cost.codexTaskAllocationPercent, 0),
    codexRemainingWeeklyBudgetUsd: normalizeNullableNumber(cost.codexRemainingWeeklyBudgetUsd, 0),
    codexAllocationConfidence: typeof cost.codexAllocationConfidence === "string" ? cost.codexAllocationConfidence.slice(0, 60) : "unknown",
    codexAllocationSource: typeof cost.codexAllocationSource === "string" ? cost.codexAllocationSource.slice(0, 80) : "unknown",
    totalOperationalCostUsd: normalizeNullableNumber(cost.totalOperationalCostUsd, 0),
    totalEstimatedCostUsd: normalizeNullableNumber(cost.totalEstimatedCostUsd, 0),
    confidence: typeof cost.confidence === "string" ? cost.confidence.slice(0, 60) : "unknown",
    totalTokens: normalizeNullableNumber(cost.totalTokens, 0),
    inputTokens: normalizeNullableNumber(cost.inputTokens, 0),
    cachedInputTokens: normalizeNullableNumber(cost.cachedInputTokens, 0),
    outputTokens: normalizeNullableNumber(cost.outputTokens, 0),
    reasoningOutputTokens: normalizeNullableNumber(cost.reasoningOutputTokens, 0)
  };
}

function extractUsage(logText) {
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0
  };
  for (const line of logText.split(/\\r?\\n/u)) {
    if (!line.trim()) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const item = event?.usage;
    if (event?.type !== "turn.completed" || typeof item !== "object" || item === null) {
      continue;
    }
    const inputTokens = Number(item.input_tokens || 0);
    const cachedInputTokens = Number(item.cached_input_tokens || 0);
    const outputTokens = Number(item.output_tokens || 0);
    const reasoningOutputTokens = Number(item.reasoning_output_tokens || 0);
    usage.inputTokens += Number.isFinite(inputTokens) ? inputTokens : 0;
    usage.cachedInputTokens += Number.isFinite(cachedInputTokens) ? cachedInputTokens : 0;
    usage.outputTokens += Number.isFinite(outputTokens) ? outputTokens : 0;
    usage.reasoningOutputTokens += Number.isFinite(reasoningOutputTokens) ? reasoningOutputTokens : 0;
  }
  usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return usage;
}

function buildCostEstimate(status, logText) {
  return normalizeCost(
    calculateSubscriptionSpend({
      usage: extractTokenUsage(logText),
      startedAt: status.startedAt,
      finishedAt: status.finishedAt,
      costs: config.costs
    })
  );
}

async function postUpdate(payload) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "authorization": "Bearer " + config.token,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("dashboard ingest failed: " + response.status + " " + await response.text());
  }
}

function buildTelemetry(kind, prompt, status, logTail, summary, durableHistory) {
  const events = extractLiveEvents(logTail, { limit: 220 });
  const files = aggregateFileActivity(events, 140);
  const spend = buildCostEstimate(status, logTail);
  const goals = summary.goals?.length ? summary.goals : deriveGoalsFromPrompt(prompt);
  const subgoals = summary.subgoals?.length ? summary.subgoals : deriveSubgoalsFromEvents(events);
  const lines = logTail ? logTail.split(/\\r?\\n/u) : [];
  return {
    version: 1,
    kind,
    durableHistory,
    generatedAt: new Date().toISOString(),
    currentActivity: currentActivityFromEvents(events, summary.currentActivity || "Waiting for structured activity."),
    events,
    files,
    goals,
    subgoals,
    tokenUsage: extractTokenUsage(logTail),
    spend,
    progress: {
      percent: summary.progressPercent,
      confidence: summary.progressConfidence
    },
    cursor: {
      logTailLineCount: lines.filter(Boolean).length,
      logTailChars: logTail.length,
      lastEventId: events.at(-1)?.id ?? null
    }
  };
}

function buildPayload(prompt, status, summary, logTail, kind, durableHistory) {
  const telemetry = buildTelemetry(kind, prompt, status, logTail, summary, durableHistory);
  const normalizedSummary = normalizeSummary({
    ...summary,
    currentActivity: telemetry.currentActivity || summary.currentActivity,
    goals: telemetry.goals,
    subgoals: telemetry.subgoals,
    cost: telemetry.spend
  });
  const payload = {
    version: 2,
    generatedAt: telemetry.generatedAt,
    projectSlug: config.projectSlug,
    taskId: config.taskId,
    sessionName: config.taskSessionName,
    observerSessionName: config.observerSession,
    remoteHost: config.remoteHost,
    status,
    summary: normalizedSummary,
    telemetry: {
      ...telemetry,
      goals: normalizedSummary.goals,
      subgoals: normalizedSummary.subgoals
    },
    logFile: config.logFile,
    logTail
  };
  fs.mkdirSync(path.dirname(config.summaryFile), { recursive: true });
  fs.writeFileSync(config.summaryFile, JSON.stringify(payload, null, 2) + "\\n");
  return payload;
}

async function liveTick(prompt, latestSummary) {
  const status = readJson(config.statusFile);
  const logTail = tailLines(config.logFile, config.maxLogLines);
  const events = extractLiveEvents(logTail, { limit: 220 });
  const summary = finalizeSummaryForStatus(
    normalizeSummary({
      ...latestSummary,
      currentActivity: currentActivityFromEvents(events, latestSummary.currentActivity),
      subgoals: latestSummary.subgoals?.length ? latestSummary.subgoals : deriveSubgoalsFromEvents(events),
      cost: buildCostEstimate(status, logTail)
    }),
    status
  );
  const payload = buildPayload(prompt, status, summary, logTail, "live", false);
  await postUpdate(payload);
  return {
    status: typeof status.status === "string" ? status.status : "unknown",
    summary
  };
}

async function summaryTick(prompt) {
  const status = readJson(config.statusFile);
  const logTail = tailLines(config.logFile, config.maxLogLines);
  const events = extractLiveEvents(logTail, { limit: 220 });
  let summary;
  try {
    summary = runCodexSummary(observerPrompt(prompt, status, logTail));
  } catch (error) {
    console.error(new Date().toISOString(), error instanceof Error ? error.message : String(error));
    summary = buildFallbackSummary(status, logTail, prompt, events);
  }
  summary = finalizeSummaryForStatus(summary, status);
  summary.cost = buildCostEstimate(status, logTail);
  if (!summary.goals?.length) {
    summary.goals = deriveGoalsFromPrompt(prompt);
  }
  if (!summary.subgoals?.length) {
    summary.subgoals = deriveSubgoalsFromEvents(events);
  }

  const payload = buildPayload(prompt, status, summary, logTail, "summary", true);
  await postUpdate(payload);
  return {
    status: typeof status.status === "string" ? status.status : "unknown",
    summary: payload.summary
  };
}

function finalizeSummaryForStatus(summary, status) {
  const state = typeof status.status === "string" ? status.status : "unknown";
  if (state === "completed") {
    return {
      ...summary,
      remaining: [],
      blockers: [],
      isStuck: false,
      progressPercent: 100,
      progressConfidence: "high",
      etaMinutesMin: 0,
      etaMinutesMax: 0,
      etaConfidence: "high"
    };
  }
  if (state === "failed" || state === "stopped") {
    return {
      ...summary,
      progressPercent: summary.progressPercent ?? 100,
      etaMinutesMin: 0,
      etaMinutesMax: 0,
      etaConfidence: "high"
    };
  }
  return summary;
}

async function main() {
  fs.mkdirSync(config.codexHome, { recursive: true });
  const prompt = readText(config.promptFile);
  let status = "unknown";
  let latestSummary = buildFallbackSummary(readJson(config.statusFile), "", prompt, []);
  let lastSummaryAt = 0;
  while (true) {
    const live = await liveTick(prompt, latestSummary);
    status = live.status;
    latestSummary = live.summary;
    const shouldSummarize = terminalStatuses.has(status) || Date.now() - lastSummaryAt >= config.intervalSeconds * 1000;
    if (shouldSummarize) {
      const durable = await summaryTick(prompt);
      status = durable.status;
      latestSummary = durable.summary;
      lastSummaryAt = Date.now();
    }
    if (terminalStatuses.has(status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, config.liveIntervalSeconds * 1000));
  }
}

main().catch((error) => {
  console.error(new Date().toISOString(), error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
`;
}
//# sourceMappingURL=dashboard.js.map