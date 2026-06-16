import path from "node:path";
import { Command } from "commander";
import { bootstrap } from "./commands/bootstrap.js";
import { doctor } from "./commands/doctor.js";
import { initProject } from "./commands/init.js";
import { pullProject, pushProject } from "./commands/sync.js";
import {
  attachTask,
  runTask,
  stopTask,
  taskLogs,
  taskStatus
} from "./commands/tasks.js";
import { upDevcontainer } from "./commands/up.js";
import { createCommandContext } from "./context.js";

interface GlobalOptions {
  cwd: string;
  dryRun?: boolean;
  json?: boolean;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("agent-runner")
    .description("Mirror a Codespace project to a VPS and run long Codex tasks inside its devcontainer.")
    .version("0.1.0")
    .option("-C, --cwd <path>", "project directory", process.cwd())
    .option("--dry-run", "print or simulate remote/sync actions where supported")
    .option("--json", "emit machine-readable output");

  program
    .command("init")
    .description("Create .agent-runner.json in the current project")
    .option("-f, --force", "overwrite an existing config file")
    .action(async (options: { force?: boolean }) => {
      const globals = getGlobals(program);
      const result = await initProject(path.resolve(globals.cwd), options);
      write(globals, result, result.created ? `created ${result.path}` : `${result.path} already exists`);
    });

  program
    .command("doctor")
    .description("Validate local tools, project structure, and runner configuration")
    .action(async () => {
      const globals = getGlobals(program);
      const result = await doctor(createContext(globals));
      write(globals, result, formatDoctor(result));
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  program
    .command("bootstrap")
    .description("Prepare the VPS runner root and required host tools")
    .action(async () => {
      const globals = getGlobals(program);
      await bootstrap(createContext(globals));
      write(globals, { ok: true }, "remote bootstrap complete");
    });

  program
    .command("push")
    .description("Mirror the local project directory to the VPS")
    .action(async () => {
      const globals = getGlobals(program);
      const digest = await pushProject(createContext(globals));
      write(globals, { digest }, `pushed workspace manifest ${digest}`);
    });

  program
    .command("pull")
    .description("Sync remote VPS changes back, refusing if the local project diverged")
    .action(async () => {
      const globals = getGlobals(program);
      const digest = await pullProject(createContext(globals));
      write(globals, { digest }, `pulled workspace manifest ${digest}`);
    });

  program
    .command("up")
    .description("Start the project devcontainer on the VPS and install/authenticate Codex inside it")
    .action(async () => {
      const globals = getGlobals(program);
      await upDevcontainer(createContext(globals));
      write(globals, { ok: true }, "remote devcontainer is ready");
    });

  program
    .command("run")
    .description("Run a long Codex task remotely inside tmux")
    .argument("<prompt>", "task prompt")
    .option("--task-id <id>", "explicit task id for reproducible automation")
    .action(async (prompt: string, options: { taskId?: string }) => {
      const globals = getGlobals(program);
      const result = await runTask(createContext(globals), prompt, { taskId: options.taskId });
      write(globals, result, `started ${result.sessionName}\nlog: ${result.logFile}`);
    });

  program
    .command("status")
    .description("Print the latest task status, or a specific task status")
    .argument("[taskId]", "remote task id")
    .action(async (taskId?: string) => {
      const globals = getGlobals(program);
      const status = await taskStatus(createContext(globals), taskId);
      if (globals.json) {
        console.log(status);
      } else {
        console.log(status);
      }
    });

  program
    .command("logs")
    .description("Print task logs")
    .argument("[taskId]", "remote task id")
    .option("-n, --lines <count>", "tail the last N lines", parseInteger)
    .action(async (taskId: string | undefined, options: { lines?: number }) => {
      const globals = getGlobals(program);
      console.log(await taskLogs(createContext(globals), taskId, options.lines));
    });

  program
    .command("attach")
    .description("Attach to the remote tmux session for a task")
    .argument("[taskId]", "remote task id")
    .action(async (taskId?: string) => {
      await attachTask(createContext(getGlobals(program)), taskId);
    });

  program
    .command("stop")
    .description("Stop the remote tmux session for a task")
    .argument("[taskId]", "remote task id")
    .action(async (taskId?: string) => {
      const globals = getGlobals(program);
      await stopTask(createContext(globals), taskId);
      write(globals, { ok: true }, "task stopped");
    });

  return program;
}

function getGlobals(program: Command): GlobalOptions {
  return program.optsWithGlobals() as GlobalOptions;
}

function createContext(options: GlobalOptions) {
  return createCommandContext(path.resolve(options.cwd), { dryRun: options.dryRun });
}

function write(options: GlobalOptions, value: unknown, text: string): void {
  if (options.json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(text);
  }
}

function formatDoctor(result: Awaited<ReturnType<typeof doctor>>): string {
  return result.checks
    .map((check) => `${check.ok ? "ok" : "fail"}  ${check.name}: ${check.detail}`)
    .join("\n");
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}
