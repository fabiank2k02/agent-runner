import type { CommandContext } from "../context.js";
import { joinRemotePath } from "../quote.js";
import { quoteRemotePath, shellQuote } from "../quote.js";
import type { TaskState } from "../state.js";

export interface DashboardObserverResult {
  enabled: boolean;
  sessionName?: string;
  summaryFile?: string;
  logFile?: string;
  error?: string;
}

export async function startDashboardObserver(
  context: CommandContext,
  task: TaskState
): Promise<DashboardObserverResult> {
  const { config, layout, remote } = context;
  if (!config.dashboard.enabled) {
    return { enabled: false };
  }
  if (!config.dashboard.endpoint) {
    throw new Error("Dashboard is enabled, but AGENT_RUNNER_DASHBOARD_ENDPOINT is not set.");
  }
  if (!config.dashboard.token) {
    throw new Error(`Dashboard is enabled, but ${config.dashboard.tokenEnv} is not set.`);
  }

  const observerSession = observerSessionName(layout.projectSlug, task.taskId);
  const observerDir = joinRemotePath(layout.remoteRoot, "observer", layout.projectSlug, task.taskId);
  const codexHome = joinRemotePath(observerDir, "codex-home");
  const summaryFile = `${layout.remoteProjectLogDir}/${task.taskId}.summary.json`;
  const observerLogFile = `${layout.remoteProjectLogDir}/${task.taskId}.observer.log`;
  const observerScriptFile = `${layout.remoteProjectLogDir}/${task.taskId}.observer.mjs`;

  await remote.run(`mkdir -p ${quoteRemotePath(observerDir)} ${quoteRemotePath(codexHome)} ${quoteRemotePath(layout.remoteProjectLogDir)}`);
  await remote.run(
    `[ -f ${quoteRemotePath(layout.remoteCodexAuthFile)} ] && cp ${quoteRemotePath(layout.remoteCodexAuthFile)} ${quoteRemotePath(joinRemotePath(codexHome, "auth.json"))} && chmod 600 ${quoteRemotePath(joinRemotePath(codexHome, "auth.json"))} || true`
  );
  await remote.writeText(observerScriptFile, buildObserverScript(context, task, observerSession, codexHome, summaryFile), "700");
  await remote.run(
    `tmux new-session -d -s ${shellQuote(observerSession)} ${shellQuote(
      `PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH" node ${quoteRemotePath(observerScriptFile)} >> ${quoteRemotePath(observerLogFile)} 2>&1`
    )}`
  );

  return {
    enabled: true,
    sessionName: observerSession,
    summaryFile,
    logFile: observerLogFile
  };
}

function observerSessionName(projectSlug: string, taskId: string): string {
  return `agent-runner-${projectSlug}-observer-${taskId}`.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 180);
}

function buildObserverScript(
  context: CommandContext,
  task: TaskState,
  observerSession: string,
  codexHome: string,
  summaryFile: string
): string {
  const config = {
    endpoint: context.config.dashboard.endpoint,
    token: context.config.dashboard.token,
    intervalSeconds: context.config.dashboard.intervalSeconds,
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

function buildFallbackSummary(status, logTail) {
  const state = typeof status.status === "string" ? status.status : "unknown";
  return normalizeSummary({
    currentActivity: state === "completed" ? "Task completed." : state === "failed" ? "Task failed." : "Task is running; no structured observer summary was available.",
    completed: state === "completed" ? ["Remote Codex task completed"] : [],
    remaining: terminalStatuses.has(state) ? [] : ["Wait for more task output"],
    blockers: state === "failed" ? ["Remote Codex task exited with a failure status"] : [],
    isStuck: false,
    progressPercent: state === "completed" ? 100 : null,
    progressConfidence: state === "completed" ? "high" : "low",
    etaMinutesMin: state === "running" ? 1 : terminalStatuses.has(state) ? 0 : null,
    etaMinutesMax: state === "running" ? 20 : terminalStatuses.has(state) ? 0 : null,
    etaConfidence: terminalStatuses.has(state) ? "high" : "low"
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
      etaConfidence: "low|medium|high"
    }),
    "Use null for unknown numeric estimates. Keep arrays short. Estimate ETA when there is enough signal from status and logs.",
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
    cost: normalizeCost(summary.cost)
  };
}

function normalizeCost(value) {
  const cost = typeof value === "object" && value !== null ? value : {};
  return {
    elapsedMinutes: normalizeNullableNumber(cost.elapsedMinutes, 0),
    digitalOceanHourlyUsd: normalizeNullableNumber(cost.digitalOceanHourlyUsd, 0),
    digitalOceanCostUsd: normalizeNullableNumber(cost.digitalOceanCostUsd, 0),
    codexSubscriptionMonthlyUsd: normalizeNullableNumber(cost.codexSubscriptionMonthlyUsd, 0),
    codexSubscriptionMonthlyTokens: normalizeNullableNumber(cost.codexSubscriptionMonthlyTokens, 0),
    codexTokenCostUsd: normalizeNullableNumber(cost.codexTokenCostUsd, 0),
    totalEstimatedCostUsd: normalizeNullableNumber(cost.totalEstimatedCostUsd, 0),
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
  const startedAt = typeof status.startedAt === "string" ? Date.parse(status.startedAt) : NaN;
  const finishedAt = typeof status.finishedAt === "string" ? Date.parse(status.finishedAt) : NaN;
  const end = Number.isFinite(finishedAt) ? finishedAt : Date.now();
  const elapsedMinutes = Number.isFinite(startedAt) ? Math.max(0, (end - startedAt) / 60000) : null;
  const usage = extractUsage(logText);
  const digitalOceanHourlyUsd = normalizeNullableNumber(config.costs?.digitalOceanHourlyUsd, 0);
  const digitalOceanCostUsd =
    elapsedMinutes === null || digitalOceanHourlyUsd === null ? null : digitalOceanHourlyUsd * (elapsedMinutes / 60);
  const codexSubscriptionMonthlyUsd = normalizeNullableNumber(config.costs?.codexSubscriptionMonthlyUsd, 0);
  const codexSubscriptionMonthlyTokens = normalizeNullableNumber(config.costs?.codexSubscriptionMonthlyTokens, 0);
  const codexTokenCostUsd =
    codexSubscriptionMonthlyUsd === null || codexSubscriptionMonthlyTokens === null || codexSubscriptionMonthlyTokens === 0
      ? null
      : usage.totalTokens * (codexSubscriptionMonthlyUsd / codexSubscriptionMonthlyTokens);
  const knownParts = [digitalOceanCostUsd, codexTokenCostUsd].filter((value) => typeof value === "number");
  return normalizeCost({
    elapsedMinutes,
    digitalOceanHourlyUsd,
    digitalOceanCostUsd,
    codexSubscriptionMonthlyUsd,
    codexSubscriptionMonthlyTokens,
    codexTokenCostUsd,
    totalEstimatedCostUsd: knownParts.length ? knownParts.reduce((sum, value) => sum + value, 0) : null,
    ...usage
  });
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

async function tick() {
  const prompt = readText(config.promptFile);
  const status = readJson(config.statusFile);
  const logTail = tailLines(config.logFile, config.maxLogLines);
  let summary;
  try {
    summary = runCodexSummary(observerPrompt(prompt, status, logTail));
  } catch (error) {
    console.error(new Date().toISOString(), error instanceof Error ? error.message : String(error));
    summary = buildFallbackSummary(status, logTail);
  }
  summary = finalizeSummaryForStatus(summary, status);
  summary.cost = buildCostEstimate(status, logTail);

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectSlug: config.projectSlug,
    taskId: config.taskId,
    sessionName: config.taskSessionName,
    observerSessionName: config.observerSession,
    remoteHost: config.remoteHost,
    status,
    summary,
    logFile: config.logFile,
    logTail
  };
  fs.mkdirSync(path.dirname(config.summaryFile), { recursive: true });
  fs.writeFileSync(config.summaryFile, JSON.stringify(payload, null, 2) + "\\n");
  await postUpdate(payload);
  return typeof status.status === "string" ? status.status : "unknown";
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
  let status = "unknown";
  while (true) {
    status = await tick();
    if (terminalStatuses.has(status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

main().catch((error) => {
  console.error(new Date().toISOString(), error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
`;
}
