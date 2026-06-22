import { randomBytes } from "node:crypto";
import type { CommandContext } from "../context.js";
import { quoteRemotePath, shellQuote } from "../quote.js";
import {
  readLocalState,
  stateWithTask,
  writeLocalState,
  type TaskState
} from "../state.js";
import {
  DashboardLaunchError,
  assertDashboardLaunchConfig,
  startDashboardObserver,
  type DashboardObserverResult
} from "./dashboard.js";

export interface RunTaskResult extends TaskState {
  statusFile: string;
  logFile: string;
  dashboardObserver?: DashboardObserverResult;
}

export function createTaskId(date = new Date()): string {
  const timestamp = date.toISOString().replace(/[-:]/gu, "").replace(/\..+$/u, "Z");
  return `${timestamp}-${randomBytes(3).toString("hex")}`;
}

export function sessionName(projectSlug: string, taskId: string): string {
  return `agent-runner-${projectSlug}-${taskId}`.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 180);
}

export async function runTask(context: CommandContext, prompt: string, options: { taskId?: string } = {}): Promise<RunTaskResult> {
  const { config, layout, remote } = context;
  assertDashboardLaunchConfig(context);
  const taskId = normalizeTaskId(options.taskId ?? createTaskId());
  const session = sessionName(layout.projectSlug, taskId);
  const promptFile = `${layout.remoteProjectLogDir}/${taskId}.prompt.txt`;
  const logFile = `${layout.remoteProjectLogDir}/${taskId}.jsonl`;
  const statusFile = `${layout.remoteProjectLogDir}/${taskId}.status.json`;
  const scriptFile = `${layout.remoteProjectLogDir}/${taskId}.run.sh`;
  const appClientFile = `${layout.remoteProjectDir}/.agent-runner/tmp/${taskId}.app-server.mjs`;
  const appClientRelativeFile = `.agent-runner/tmp/${taskId}.app-server.mjs`;
  const artifactDirectory = `${layout.remoteProjectDir}/.agent-runner/artifacts/${taskId}`;
  const artifactManifestFile = `${artifactDirectory}/manifest.json`;
  const startedAt = new Date().toISOString();
  const executionPath = config.codex.execution;
  const allowExecFallback = config.codex.allowExecFallback;

  await remote.run(`mkdir -p ${quoteRemotePath(layout.remoteProjectLogDir)} ${quoteRemotePath(`${layout.remoteProjectDir}/.agent-runner/tmp`)}`);
  await remote.writeText(promptFile, prompt, "600");
  if (executionPath === "app-server") {
    await remote.writeText(appClientFile, buildAppServerClientScript(context, taskId), "755");
  }

  const codexCommand = [
    "codex",
    "exec",
    "--json",
    "-c",
    shellQuote(`model_reasoning_effort=${JSON.stringify(config.codex.reasoningEffort)}`),
    ...(config.codex.yolo
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : [
          "--sandbox",
          shellQuote(config.codex.sandbox),
          "-c",
          shellQuote(`approval_policy=${JSON.stringify(config.codex.approval)}`)
        ]),
    ...(config.codex.model ? ["--model", shellQuote(config.codex.model)] : []),
    ...config.codex.extraArgs.map(shellQuote)
  ].join(" ");
  const execCommand = `PATH="$HOME/.local/bin:$PATH" ${codexCommand} "$0"`;
  const appServerCommand = `PATH="$HOME/.local/bin:$PATH" node ${shellQuote(appClientRelativeFile)} "$0"`;

  const script = `
#!/usr/bin/env bash
set -u
WORKSPACE=${quoteRemotePath(layout.remoteProjectDir)}
PROMPT_FILE=${quoteRemotePath(promptFile)}
LOG_FILE=${quoteRemotePath(logFile)}
STATUS_FILE=${quoteRemotePath(statusFile)}
ARTIFACT_DIR=${quoteRemotePath(artifactDirectory)}
ARTIFACT_MANIFEST_FILE=${quoteRemotePath(artifactManifestFile)}
STARTED_AT=${shellQuote(startedAt)}
TASK_ID=${shellQuote(taskId)}
SESSION_NAME=${shellQuote(session)}
EXECUTION_PATH=${shellQuote(executionPath)}
ALLOW_EXEC_FALLBACK=${allowExecFallback ? "1" : "0"}
FALLBACK_USED=false
write_status() {
  local status="$1"
  local exit_code="$2"
  local finished="$3"
  local finished_json
  if [ "$finished" = "null" ]; then
    finished_json=null
  else
    finished_json="\\"$finished\\""
  fi
  local artifact_json=""
  if [ -f "$ARTIFACT_MANIFEST_FILE" ]; then
    local artifact_count
    artifact_count="$(node -e 'const fs=require("fs"); const manifest=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(Array.isArray(manifest.images) ? manifest.images.length : 0));' "$ARTIFACT_MANIFEST_FILE" 2>/dev/null || true)"
    if [ -n "$artifact_count" ]; then
      artifact_json=',"artifactManifestFile":"'"$ARTIFACT_MANIFEST_FILE"'","artifactDirectory":"'"$ARTIFACT_DIR"'","artifactCount":'"$artifact_count"
    else
      artifact_json=',"artifactManifestFile":"'"$ARTIFACT_MANIFEST_FILE"'","artifactDirectory":"'"$ARTIFACT_DIR"'"'
    fi
  fi
  printf '{"taskId":"%s","sessionName":"%s","status":"%s","exitCode":%s,"startedAt":"%s","finishedAt":%s,"logFile":"%s","executionPath":"%s","fallbackUsed":%s%s}\\n' \\
    "$TASK_ID" "$SESSION_NAME" "$status" "$exit_code" "$STARTED_AT" "$finished_json" "$LOG_FILE" "$EXECUTION_PATH" "$FALLBACK_USED" "$artifact_json" > "$STATUS_FILE"
}
write_status running null null
prompt="$(cat "$PROMPT_FILE")"
if [ "$EXECUTION_PATH" = "app-server" ]; then
  devcontainer exec --workspace-folder "$WORKSPACE" sh -lc ${shellQuote(appServerCommand)} "$prompt" < /dev/null > "$LOG_FILE" 2>&1
  code=$?
  if [ "$code" -ne 0 ] && [ "$ALLOW_EXEC_FALLBACK" = "1" ]; then
    FALLBACK_USED=true
    EXECUTION_PATH=exec-fallback
    printf '{"type":"error","message":"app-server execution failed; explicit codex exec fallback starting","appServerExitCode":%s,"timestamp":"%s"}\\n' "$code" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$LOG_FILE"
    write_status running null null
    devcontainer exec --workspace-folder "$WORKSPACE" sh -lc ${shellQuote(execCommand)} "$prompt" < /dev/null >> "$LOG_FILE" 2>&1
    code=$?
  fi
else
  devcontainer exec --workspace-folder "$WORKSPACE" sh -lc ${shellQuote(execCommand)} "$prompt" < /dev/null > "$LOG_FILE" 2>&1
  code=$?
fi
finished=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [ "$code" -eq 0 ]; then
  write_status completed "$code" "$finished"
else
  write_status failed "$code" "$finished"
fi
exit "$code"
`.trimStart();

  await remote.writeText(scriptFile, script, "700");
  await remote.run(`tmux new-session -d -s ${shellQuote(session)} ${quoteRemotePath(scriptFile)}`);

  let task: TaskState = {
    taskId,
    sessionName: session,
    statusFile,
    logFile,
    promptFile,
    artifactDirectory,
    artifactManifestFile,
    startedAt
  };
  const existing = await readLocalState(layout);
  await writeLocalState(layout, stateWithTask(layout, task, existing));

  let dashboardObserver: DashboardObserverResult;
  try {
    dashboardObserver = await startDashboardObserver(context, task);
  } catch (error) {
    await remote.run(`tmux kill-session -t ${shellQuote(session)} 2>/dev/null || true`);
    if (error instanceof DashboardLaunchError) {
      throw error;
    }
    throw new DashboardLaunchError(error instanceof Error ? error.message : String(error));
  }
  if (dashboardObserver.enabled) {
    task = {
      ...task,
      dashboardObserverSessionName: dashboardObserver.sessionName,
      dashboardSummaryFile: dashboardObserver.summaryFile,
      dashboardObserverLogFile: dashboardObserver.logFile
    };
    await writeLocalState(layout, stateWithTask(layout, task, existing));
  }
  return { ...task, statusFile, logFile, dashboardObserver };
}

export async function taskStatus(context: CommandContext, taskId?: string): Promise<string> {
  const task = await resolveTask(context, taskId);
  const tmux = await context.remote.run(`tmux has-session -t ${shellQuote(task.sessionName)} >/dev/null 2>&1 && echo running || true`);
  const status = await context.remote.run(
    `[ -f ${quoteRemotePath(task.statusFile)} ] && cat ${quoteRemotePath(task.statusFile)} || true`
  );
  return status.stdout || JSON.stringify({ taskId: task.taskId, sessionName: task.sessionName, status: tmux.stdout || "unknown" });
}

export async function taskLogs(context: CommandContext, taskId?: string, lines?: number): Promise<string> {
  const task = await resolveTask(context, taskId);
  const command = lines
    ? `tail -n ${Number(lines)} ${quoteRemotePath(task.logFile)}`
    : `cat ${quoteRemotePath(task.logFile)}`;
  const result = await context.remote.run(`[ -f ${quoteRemotePath(task.logFile)} ] && ${command} || true`);
  return result.stdout;
}

export async function attachTask(context: CommandContext, taskId?: string): Promise<void> {
  const task = await resolveTask(context, taskId);
  await context.remote.interactive(`tmux attach-session -t ${shellQuote(task.sessionName)}`);
}

export async function stopTask(context: CommandContext, taskId?: string): Promise<void> {
  const task = await resolveTask(context, taskId);
  await context.remote.run(`tmux kill-session -t ${shellQuote(task.sessionName)} 2>/dev/null || true`);
}

async function resolveTask(context: CommandContext, taskId?: string): Promise<TaskState> {
  const state = await readLocalState(context.layout);
  if (!state?.lastTask) {
    throw new Error("No task state found. Pass a task id or run agent-runner run first.");
  }
  const normalizedTaskId = taskId ? normalizeTaskId(taskId) : undefined;
  if (normalizedTaskId && normalizedTaskId !== state.lastTask.taskId) {
    const logFile = `${context.layout.remoteProjectLogDir}/${normalizedTaskId}.jsonl`;
    return {
      taskId: normalizedTaskId,
      sessionName: sessionName(context.layout.projectSlug, normalizedTaskId),
      statusFile: `${context.layout.remoteProjectLogDir}/${normalizedTaskId}.status.json`,
      logFile,
      promptFile: `${context.layout.remoteProjectLogDir}/${normalizedTaskId}.prompt.txt`,
      startedAt: ""
    };
  }
  return state.lastTask;
}

function normalizeTaskId(taskId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/u.test(taskId)) {
    throw new Error("Task id may only contain letters, numbers, dots, underscores, and dashes.");
  }
  return taskId;
}

function buildAppServerClientScript(context: CommandContext, taskId: string): string {
  const config = {
    model: context.config.codex.model ?? null,
    reasoningEffort: context.config.codex.reasoningEffort,
    approval: context.config.codex.approval,
    sandbox: context.config.codex.sandbox,
    yolo: context.config.codex.yolo,
    projectSlug: context.layout.projectSlug,
    taskId,
    artifactDirRelative: `.agent-runner/artifacts/${taskId}`,
    clientVersion: "0.1.0"
  };

  return `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const config = ${JSON.stringify(config, null, 2)};
const prompt = process.argv[2] || "";
const timeoutMs = Number(process.env.AGENT_RUNNER_APP_SERVER_TIMEOUT_MS || 12 * 60 * 60 * 1000);
let nextId = 1;
let threadId = null;
let turnStarted = false;
let completed = false;
let failed = false;
let exiting = false;
const pending = new Map();
const artifactState = createArtifactState(config.taskId, config.artifactDirRelative);
let artifactQueue = Promise.resolve();

const child = spawn("codex", ["app-server", "--stdio"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    PATH: [(process.env.HOME || "") + "/.local/bin", process.env.PATH || ""].filter(Boolean).join(":")
  }
});

const rl = readline.createInterface({ input: child.stdout });
const timeout = setTimeout(() => {
  fail("app-server turn timed out after " + timeoutMs + "ms");
}, timeoutMs);

child.on("error", (error) => fail("unable to start codex app-server: " + error.message));
child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  if (exiting) {
    return;
  }
  if (!completed) {
    log({
      type: "error",
      timestamp: new Date().toISOString(),
      message: "codex app-server exited before turn completion",
      exitCode: code,
      signal
    });
    process.exit(code || 42);
  }
  process.exit(failed ? 1 : 0);
});

rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    log({ type: "error", timestamp: new Date().toISOString(), message: "invalid app-server JSON", detail: line });
    failed = true;
    return;
  }

  log(normalizeForLog(message));
  artifactQueue = artifactQueue
    .then(() => inspectArtifacts(message))
    .catch((error) => {
      log({
        type: "artifact.error",
        timestamp: new Date().toISOString(),
        artifactManifestFile: artifactState.manifestFileRelative,
        message: error instanceof Error ? error.message : String(error)
      });
    });
  if (message.id !== undefined && message.method) {
    handleServerRequest(message);
  } else if (message.id !== undefined) {
    handleResponse(message);
  } else if (message.method) {
    handleNotification(message);
  }
});

request("initialize", {
  clientInfo: {
    name: "agent_runner",
    title: "Agent Runner",
    version: config.clientVersion
  },
  capabilities: {
    experimentalApi: true
  }
});

function request(method, params) {
  const id = nextId++;
  pending.set(id, method);
  send({ id, method, params });
  return id;
}

function notify(method, params) {
  send({ method, params });
}

function respond(id, result) {
  send({ id, result });
}

function reject(id, message) {
  send({ id, error: { code: -32000, message } });
}

function send(message) {
  child.stdin.write(JSON.stringify(message) + "\\n");
}

function handleResponse(message) {
  const method = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) {
    fail("app-server " + (method || "request") + " failed: " + (message.error.message || JSON.stringify(message.error)));
    return;
  }

  if (method === "initialize") {
    notify("initialized", {});
    request("thread/start", {
      model: config.model,
      cwd: process.cwd(),
      approvalPolicy: config.yolo ? "never" : config.approval,
      sandboxPolicy: sandboxPolicy()
    });
    return;
  }

  if (method === "thread/start") {
    threadId = message.result?.thread?.id || message.result?.threadId || message.result?.id || null;
    if (!threadId) {
      fail("app-server thread/start did not return a thread id");
      return;
    }
    request("turn/start", {
      threadId,
      cwd: process.cwd(),
      model: config.model,
      effort: config.reasoningEffort,
      approvalPolicy: config.yolo ? "never" : config.approval,
      sandboxPolicy: sandboxPolicy(),
      input: [{ type: "text", text: prompt }]
    });
    return;
  }

  if (method === "turn/start") {
    turnStarted = true;
  }
}

function handleServerRequest(message) {
  if (message.method === "item/commandExecution/requestApproval") {
    if (config.yolo) {
      respond(message.id, { decision: "acceptForSession" });
    } else {
      respond(message.id, { decision: "cancel" });
      fail("app-server requested command approval while yolo mode is disabled");
    }
    return;
  }

  if (message.method === "item/fileChange/requestApproval") {
    if (config.yolo) {
      respond(message.id, { decision: "acceptForSession" });
    } else {
      respond(message.id, { decision: "cancel" });
      fail("app-server requested file-change approval while yolo mode is disabled");
    }
    return;
  }

  if (message.method === "item/permissions/requestApproval") {
    if (config.yolo) {
      respond(message.id, {
        permissions: {
          fileSystem: {
            entries: [{ access: "write", path: { type: "special", value: { kind: "root" } } }]
          },
          network: { enabled: true }
        },
        scope: "session"
      });
    } else {
      respond(message.id, { permissions: {}, scope: "turn" });
      fail("app-server requested additional permissions while yolo mode is disabled");
    }
    return;
  }

  reject(message.id, "Agent Runner cannot satisfy app-server request " + message.method);
  fail("unsupported app-server request: " + message.method);
}

function handleNotification(message) {
  if (message.method === "error") {
    failed = true;
  }
  if (message.method === "turn/completed") {
    completed = true;
    const status = message.params?.turn?.status || "unknown";
    if (status !== "completed") {
      failed = true;
    }
    artifactQueue
      .then(() => writeArtifactManifestIfNeeded())
      .finally(() => setTimeout(() => shutdown(failed ? 1 : 0), 250));
  }
}

function fail(message) {
  if (failed && exiting) {
    return;
  }
  failed = true;
  log({ type: "error", timestamp: new Date().toISOString(), message });
  setTimeout(() => shutdown(1), turnStarted ? 250 : 50);
}

function shutdown(code) {
  if (exiting) {
    return;
  }
  exiting = true;
  clearTimeout(timeout);
  try {
    child.kill();
  } catch {}
  setTimeout(() => process.exit(code), 100);
}

function sandboxPolicy() {
  if (config.yolo) {
    return { type: "dangerFullAccess" };
  }
  if (config.sandbox === "read-only") {
    return { type: "readOnly", networkAccess: false };
  }
  return { type: "workspaceWrite", networkAccess: true, writableRoots: [] };
}

function createArtifactState(taskId, artifactDirRelative) {
  const imageDirRelative = path.posix.join(artifactDirRelative, "images");
  const manifestFileRelative = path.posix.join(artifactDirRelative, "manifest.json");
  return {
    taskId,
    artifactDirRelative,
    imageDirRelative,
    manifestFileRelative,
    artifactDir: path.resolve(process.cwd(), artifactDirRelative),
    imageDir: path.resolve(process.cwd(), imageDirRelative),
    manifestFile: path.resolve(process.cwd(), manifestFileRelative),
    createdAt: null,
    images: [],
    blockers: [],
    seenImageHashes: new Set(),
    seenBlockers: new Set(),
    dirty: false
  };
}

async function inspectArtifacts(message) {
  await scanArtifactValue(message, "$", undefined, {
    eventMethod: message?.method,
    itemId: message?.params?.item?.id
  });
}

async function scanArtifactValue(value, sourcePath, key, context) {
  if (typeof value === "string") {
    await scanArtifactString(value, sourcePath, key, context);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      await scanArtifactValue(value[index], sourcePath + "[" + index + "]", undefined, context);
    }
    return;
  }

  await scanKnownImageItem(value, sourcePath, context);
  await scanFileReference(value, sourcePath, context);
  scanOpaqueArtifactReference(value, sourcePath, context);

  for (const [childKey, childValue] of Object.entries(value)) {
    await scanArtifactValue(childValue, sourcePath + "." + childKey, childKey, {
      ...context,
      itemId: typeof value.id === "string" ? value.id : context.itemId
    });
  }
}

async function scanKnownImageItem(record, sourcePath, context) {
  if (record.type === "imageGeneration" && typeof record.result === "string" && record.result.trim() !== "") {
    await persistImageString(record.result, sourcePath + ".result", {
      ...context,
      itemId: typeof record.id === "string" ? record.id : context.itemId,
      sourceHint: "imageGeneration.result"
    });
    if (typeof record.savedPath === "string") {
      await persistLocalImage(record.savedPath, sourcePath + ".savedPath", {
        ...context,
        itemId: typeof record.id === "string" ? record.id : context.itemId,
        sourceHint: "imageGeneration.savedPath"
      }, true);
    }
  }

  if (record.type === "image_generation_call" && typeof record.result === "string" && record.result.trim() !== "") {
    await persistImageString(record.result, sourcePath + ".result", {
      ...context,
      itemId: typeof record.id === "string" ? record.id : context.itemId,
      sourceHint: "image_generation_call.result"
    });
  }

  if (record.type === "imageView" && typeof record.path === "string") {
    await persistLocalImage(record.path, sourcePath + ".path", {
      ...context,
      itemId: typeof record.id === "string" ? record.id : context.itemId,
      sourceHint: "imageView.path"
    }, true);
  }
}

async function scanFileReference(record, sourcePath, context) {
  const hasImageMime = typeof record.mimeType === "string" && record.mimeType.startsWith("image/");
  const hasImageType = typeof record.type === "string" && /image|file/iu.test(record.type);
  for (const pathKey of ["path", "filePath", "filepath", "localPath", "savedPath"]) {
    const rawPath = record[pathKey];
    if (typeof rawPath === "string" && (hasImageMime || hasImageType || imageExtensionPattern().test(rawPath))) {
      await persistLocalImage(rawPath, sourcePath + "." + pathKey, context, true);
    }
  }

  const url = record.url ?? record.image_url ?? record.imageUrl;
  if (typeof url === "string" && (hasImageMime || hasImageType || dataUrlPattern().test(url) || imageExtensionPattern().test(url))) {
    await scanArtifactString(url, sourcePath + ".url", "url", context);
  }

  const data = record.data ?? record.base64 ?? record.b64_json;
  if (typeof data === "string" && hasImageMime) {
    await persistImageString(data, sourcePath + ".data", {
      ...context,
      sourceHint: "image base64 field"
    });
  }
}

function scanOpaqueArtifactReference(record, sourcePath, context) {
  const hasResolvableValue = ["result", "savedPath", "path", "filePath", "url", "image_url", "data", "base64", "b64_json"]
    .some((name) => record[name] !== undefined);
  if (hasResolvableValue) {
    return;
  }
  for (const idKey of ["artifactId", "artifact_id", "attachmentId", "attachment_id", "imageId", "image_id"]) {
    const value = record[idKey];
    if (typeof value === "string" && value.length > 0) {
      addArtifactBlocker({
        kind: "opaque_id",
        message: "App-server exposed an opaque image/artifact id without bytes, URL, or local file path.",
        sourcePath: sourcePath + "." + idKey,
        eventMethod: context.eventMethod,
        itemId: context.itemId,
        detail: redactArtifactId(value)
      });
    }
  }
}

async function scanArtifactString(value, sourcePath, key, context) {
  if (dataUrlPattern().test(value)) {
    await persistImageString(value, sourcePath, context);
    return;
  }
  if (/^https?:\\/\\//iu.test(value) && imageExtensionPattern().test(value)) {
    await persistHttpImage(value, sourcePath, context);
    return;
  }
  if (isPathLikeKey(key) && imageExtensionPattern().test(value)) {
    await persistLocalImage(value, sourcePath, context, true);
    return;
  }
  if ((path.isAbsolute(value) || value.startsWith("file://")) && imageExtensionPattern().test(value)) {
    await persistLocalImage(value, sourcePath, context, false);
  }
}

async function persistImageString(value, sourcePath, context) {
  const dataUrl = dataUrlPattern().exec(value);
  if (dataUrl) {
    await persistImageBuffer(Buffer.from(dataUrl[2].replace(/\\s/gu, ""), "base64"), {
      sourceKind: "data_url",
      sourcePath,
      mimeType: dataUrl[1].toLowerCase(),
      context
    });
    return;
  }

  if (looksLikeBase64(value)) {
    await persistImageBuffer(Buffer.from(value.replace(/\\s/gu, ""), "base64"), {
      sourceKind: "base64",
      sourcePath,
      context
    });
    return;
  }

  addArtifactBlocker({
    kind: "invalid_image",
    message: "Image result was not a data URL or decodable base64 image.",
    sourcePath,
    eventMethod: context.eventMethod,
    itemId: context.itemId,
    detail: context.sourceHint
  });
}

async function persistLocalImage(rawPath, sourcePath, context, required) {
  const filePath = resolveArtifactPath(rawPath);
  let bytes;
  try {
    bytes = await fs.promises.readFile(filePath);
  } catch (error) {
    if (required) {
      addArtifactBlocker({
        kind: "missing_file",
        message: "App-server referenced an image file path that does not exist or cannot be read.",
        sourcePath,
        eventMethod: context.eventMethod,
        itemId: context.itemId,
        detail: filePath + ": " + (error instanceof Error ? error.message : String(error))
      });
    }
    return;
  }
  await persistImageBuffer(bytes, {
    sourceKind: "local_file",
    sourcePath,
    originalFilePath: filePath,
    context
  });
}

async function persistHttpImage(url, sourcePath, context) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    await persistImageBuffer(Buffer.from(await response.arrayBuffer()), {
      sourceKind: "http_url",
      sourcePath,
      mimeType: response.headers.get("content-type") ?? undefined,
      context
    });
  } catch (error) {
    addArtifactBlocker({
      kind: "download_failed",
      message: "Failed to download app-server image URL.",
      sourcePath,
      eventMethod: context.eventMethod,
      itemId: context.itemId,
      detail: url + ": " + (error instanceof Error ? error.message : String(error))
    });
  }
}

async function persistImageBuffer(bytes, options) {
  const info = detectImage(bytes, options.mimeType);
  if (!info) {
    addArtifactBlocker({
      kind: "invalid_image",
      message: "App-server image payload was not a supported PNG, JPEG, or WebP file.",
      sourcePath: options.sourcePath,
      eventMethod: options.context.eventMethod,
      itemId: options.context.itemId,
      detail: options.context.sourceHint
    });
    return;
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (artifactState.seenImageHashes.has(sha256)) {
    return;
  }
  artifactState.seenImageHashes.add(sha256);

  const index = artifactState.images.length + 1;
  const fileName = String(index).padStart(2, "0") + "-" + slugArtifactName(options.context.sourceHint || options.sourceKind) + "-" + sha256.slice(0, 12) + "." + info.extension;
  const absoluteFile = path.join(artifactState.imageDir, fileName);
  const relativeFile = path.posix.join(artifactState.imageDirRelative, fileName);
  await fs.promises.mkdir(artifactState.imageDir, { recursive: true });
  await fs.promises.writeFile(absoluteFile, bytes);

  const image = {
    id: sha256.slice(0, 16),
    sourceKind: options.sourceKind,
    sourcePath: options.sourcePath,
    file: relativeFile,
    absoluteFile,
    mimeType: info.mimeType,
    byteLength: bytes.byteLength,
    sha256,
    width: info.width,
    height: info.height,
    eventMethod: options.context.eventMethod,
    itemId: options.context.itemId
  };
  artifactState.images.push(image);
  artifactState.createdAt ||= new Date().toISOString();
  artifactState.dirty = true;
  log({
    type: "artifact.saved",
    timestamp: new Date().toISOString(),
    artifactManifestFile: artifactState.manifestFileRelative,
    artifact: image,
    originalFilePath: options.originalFilePath
  });
  await writeArtifactManifestIfNeeded();
}

async function writeArtifactManifestIfNeeded() {
  if (!artifactState.dirty && artifactState.images.length === 0 && artifactState.blockers.length === 0) {
    return null;
  }
  const now = new Date().toISOString();
  const manifest = {
    version: 1,
    taskId: artifactState.taskId,
    artifactDir: artifactState.artifactDirRelative,
    imageDir: artifactState.imageDirRelative,
    manifestFile: artifactState.manifestFileRelative,
    createdAt: artifactState.createdAt || now,
    updatedAt: now,
    images: artifactState.images,
    blockers: artifactState.blockers
  };
  await fs.promises.mkdir(artifactState.artifactDir, { recursive: true });
  await fs.promises.writeFile(artifactState.manifestFile, JSON.stringify(manifest, null, 2) + "\\n");
  artifactState.dirty = false;
  log({
    type: "artifact.manifest",
    timestamp: now,
    artifactManifestFile: artifactState.manifestFileRelative,
    artifactCount: artifactState.images.length,
    blockerCount: artifactState.blockers.length
  });
  return manifest;
}

function addArtifactBlocker(blocker) {
  const key = JSON.stringify(blocker);
  if (artifactState.seenBlockers.has(key)) {
    return;
  }
  artifactState.seenBlockers.add(key);
  artifactState.blockers.push(blocker);
  artifactState.createdAt ||= new Date().toISOString();
  artifactState.dirty = true;
  log({
    type: "artifact.blocker",
    timestamp: new Date().toISOString(),
    artifactManifestFile: artifactState.manifestFileRelative,
    blocker
  });
}

function detectImage(bytes, mimeType) {
  const png = readPngDimensions(bytes);
  if (png) {
    return { mimeType: "image/png", extension: "png", width: png.width, height: png.height };
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (typeof mimeType === "string" && mimeType.toLowerCase().startsWith("image/")) {
    return null;
  }
  return null;
}

function readPngDimensions(bytes) {
  if (bytes.length < 24) {
    return null;
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature) || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function resolveArtifactPath(rawPath) {
  if (rawPath.startsWith("file://")) {
    return new URL(rawPath).pathname;
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(process.cwd(), rawPath);
}

function dataUrlPattern() {
  return /^data:(image\\/[a-z0-9.+-]+);base64,([\\s\\S]+)$/iu;
}

function imageExtensionPattern() {
  return /\\.(?:png|webp|jpe?g)(?:[?#].*)?$/iu;
}

function looksLikeBase64(value) {
  const cleaned = value.replace(/\\s/gu, "");
  return cleaned.length >= 32 && cleaned.length % 4 === 0 && /^[a-z0-9+/]+={0,2}$/iu.test(cleaned);
}

function isPathLikeKey(key) {
  return key !== undefined && /^(?:path|filePath|filepath|localPath|savedPath)$/iu.test(key);
}

function slugArtifactName(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48);
  return slug || "image";
}

function redactArtifactId(value) {
  return value.length <= 12 ? value : value.slice(0, 6) + "..." + value.slice(-4);
}

function normalizeForLog(message) {
  const now = new Date().toISOString();
  if (message.method === "item/agentMessage/delta") {
    return {
      type: "item.completed",
      timestamp: now,
      item: {
        id: message.params?.itemId || "agent-message-delta",
        type: "agent_message",
        text: message.params?.delta || ""
      },
      appServer: { method: message.method, threadId: message.params?.threadId, turnId: message.params?.turnId }
    };
  }

  if (message.method === "item/started" || message.method === "item/completed") {
    const item = normalizeItem(message.params?.item || {});
    const millis = message.params?.startedAtMs || message.params?.completedAtMs;
    return {
      type: message.method.replaceAll("/", "."),
      timestamp: millis ? new Date(millis).toISOString() : now,
      item,
      appServer: { method: message.method, threadId: message.params?.threadId, turnId: message.params?.turnId }
    };
  }

  if (message.method === "rawResponseItem/completed") {
    return {
      type: "raw_response_item.completed",
      timestamp: now,
      item: normalizeItem(message.params?.item || {}),
      appServer: { method: message.method, threadId: message.params?.threadId, turnId: message.params?.turnId }
    };
  }

  if (message.method === "turn/completed") {
    return {
      type: "turn.completed",
      timestamp: now,
      status: message.params?.turn?.status || "unknown",
      turn: message.params?.turn || null,
      appServer: { method: message.method, threadId: message.params?.threadId }
    };
  }

  if (message.id !== undefined && message.method) {
    return {
      type: "item.started",
      timestamp: now,
      item: {
        type: "tool_call",
        name: "approval_request",
        arguments: { method: message.method, params: message.params || {} }
      },
      appServer: { method: message.method, requestId: message.id }
    };
  }

  return {
    type: message.method ? "app_server." + message.method.replaceAll("/", ".") : "app_server.response",
    timestamp: now,
    message: message.method || "response",
    appServer: message
  };
}

function normalizeItem(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  if ((item.type === "imageGeneration" || item.type === "image_generation_call") && typeof item.result === "string") {
    return {
      ...item,
      result: summarizeImageResultForLog(item.result)
    };
  }
  if (item.type === "agentMessage") {
    return { ...item, type: "agent_message" };
  }
  if (item.type === "commandExecution") {
    return {
      ...item,
      command: item.command || item.aggregatedCommand || "",
      exitCode: item.exitCode ?? null
    };
  }
  return item;
}

function summarizeImageResultForLog(result) {
  if (!result) {
    return "";
  }
  return "<image result omitted from log; " + result.length + " base64/data-url chars, persisted via artifact manifest>";
}

function log(record) {
  process.stdout.write(JSON.stringify(record) + "\\n");
}
`;
}
