import { randomBytes } from "node:crypto";
import type { CommandContext } from "../context.js";
import { quoteRemotePath, shellQuote } from "../quote.js";
import {
  readLocalState,
  stateWithTask,
  writeLocalState,
  type TaskState
} from "../state.js";

export interface RunTaskResult extends TaskState {
  statusFile: string;
  logFile: string;
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
  const taskId = normalizeTaskId(options.taskId ?? createTaskId());
  const session = sessionName(layout.projectSlug, taskId);
  const promptFile = `${layout.remoteProjectLogDir}/${taskId}.prompt.txt`;
  const logFile = `${layout.remoteProjectLogDir}/${taskId}.jsonl`;
  const statusFile = `${layout.remoteProjectLogDir}/${taskId}.status.json`;
  const scriptFile = `${layout.remoteProjectLogDir}/${taskId}.run.sh`;
  const startedAt = new Date().toISOString();

  await remote.run(`mkdir -p ${quoteRemotePath(layout.remoteProjectLogDir)}`);
  await remote.writeText(promptFile, prompt, "600");

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

  const script = `
#!/usr/bin/env bash
set -u
WORKSPACE=${quoteRemotePath(layout.remoteProjectDir)}
PROMPT_FILE=${quoteRemotePath(promptFile)}
LOG_FILE=${quoteRemotePath(logFile)}
STATUS_FILE=${quoteRemotePath(statusFile)}
STARTED_AT=${shellQuote(startedAt)}
TASK_ID=${shellQuote(taskId)}
SESSION_NAME=${shellQuote(session)}
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
  printf '{"taskId":"%s","sessionName":"%s","status":"%s","exitCode":%s,"startedAt":"%s","finishedAt":%s,"logFile":"%s"}\\n' \\
    "$TASK_ID" "$SESSION_NAME" "$status" "$exit_code" "$STARTED_AT" "$finished_json" "$LOG_FILE" > "$STATUS_FILE"
}
write_status running null null
prompt="$(cat "$PROMPT_FILE")"
devcontainer exec --workspace-folder "$WORKSPACE" sh -lc ${shellQuote(`PATH="$HOME/.local/bin:$PATH" ${codexCommand} "$0"`)} "$prompt" < /dev/null > "$LOG_FILE" 2>&1
code=$?
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

  const task: TaskState = {
    taskId,
    sessionName: session,
    statusFile,
    logFile,
    promptFile,
    startedAt
  };
  const existing = await readLocalState(layout);
  await writeLocalState(layout, stateWithTask(layout, task, existing));
  return { ...task, statusFile, logFile };
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
