import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { bootstrap } from "./commands/bootstrap.js";
import { createDroplet, dropletStatus, destroyDroplet, refreshManagedDroplet } from "./commands/droplet.js";
import { doctor } from "./commands/doctor.js";
import { initProject } from "./commands/init.js";
import { pullProject, pushProject } from "./commands/sync.js";
import { attachTask, runTask, stopTask, taskLogs, taskStatus } from "./commands/tasks.js";
import { upDevcontainer } from "./commands/up.js";
import { createCommandContext } from "./context.js";
export function buildProgram() {
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
        .action(async (options) => {
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
        .description("Sync remote VPS changes back, stashing local changes first if needed")
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
        .argument("[prompt]", "task prompt")
        .option("-f, --prompt-file <path>", "read the task prompt from a file, or '-' for stdin")
        .option("--task-id <id>", "explicit task id for reproducible automation")
        .action(async (prompt, options) => {
        const globals = getGlobals(program);
        const resolvedPrompt = await resolvePrompt(globals, prompt, options.promptFile);
        const result = await runTask(createContext(globals), resolvedPrompt, { taskId: options.taskId });
        write(globals, result, `started ${result.sessionName}\nlog: ${result.logFile}`);
    });
    program
        .command("start")
        .description("Create a managed droplet if needed, push, start the devcontainer, and run Codex")
        .argument("[prompt]", "task prompt")
        .option("-f, --prompt-file <path>", "read the task prompt from a file, or '-' for stdin")
        .option("--task-id <id>", "explicit task id for reproducible automation")
        .option("--no-create", "use the configured/active remote instead of creating a managed droplet")
        .option("--skip-up", "skip devcontainer startup/authentication")
        .action(async (prompt, options) => {
        const globals = getGlobals(program);
        const resolvedPrompt = await resolvePrompt(globals, prompt, options.promptFile);
        await startTask(globals, resolvedPrompt, options);
    });
    program
        .command("finish")
        .description("Pull remote work back and destroy the active managed droplet")
        .option("--keep-droplet", "pull work back without destroying the managed droplet")
        .action(async (options) => {
        const globals = getGlobals(program);
        await finishTask(globals, options);
    });
    program
        .command("status")
        .description("Print the latest task status, or a specific task status")
        .argument("[taskId]", "remote task id")
        .action(async (taskId) => {
        const globals = getGlobals(program);
        const status = await taskStatus(createContext(globals), taskId);
        if (globals.json) {
            console.log(status);
        }
        else {
            console.log(status);
        }
    });
    program
        .command("logs")
        .description("Print task logs")
        .argument("[taskId]", "remote task id")
        .option("-n, --lines <count>", "tail the last N lines", parseInteger)
        .action(async (taskId, options) => {
        const globals = getGlobals(program);
        console.log(await taskLogs(createContext(globals), taskId, options.lines));
    });
    program
        .command("attach")
        .description("Attach to the remote tmux session for a task")
        .argument("[taskId]", "remote task id")
        .action(async (taskId) => {
        await attachTask(createContext(getGlobals(program)), taskId);
    });
    program
        .command("stop")
        .description("Stop the remote tmux session for a task")
        .argument("[taskId]", "remote task id")
        .action(async (taskId) => {
        const globals = getGlobals(program);
        await stopTask(createContext(globals), taskId);
        write(globals, { ok: true }, "task stopped");
    });
    const droplet = program
        .command("droplet")
        .description("Manage the DigitalOcean droplet backing this project");
    droplet
        .command("create")
        .description("Create a new DigitalOcean droplet, wait for SSH, and bootstrap it")
        .option("--name <name>", "droplet name")
        .option("--region <slug>", "DigitalOcean region slug")
        .option("--size <slug>", "DigitalOcean size slug")
        .option("--image <image>", "base image slug or id")
        .option("--no-bootstrap", "create and wait for SSH without running bootstrap")
        .action(async (options) => {
        const globals = getGlobals(program);
        const result = await createDroplet(createContext(globals).config, {
            name: options.name,
            region: options.region,
            size: options.size,
            image: parseImage(options.image),
            skipBootstrap: options.bootstrap === false
        });
        write(globals, result, formatDropletCreated(result));
    });
    droplet
        .command("status")
        .description("Show the active managed droplet")
        .action(async () => {
        const globals = getGlobals(program);
        const status = await dropletStatus(createContext(globals).config);
        write(globals, status, JSON.stringify(status, null, 2));
    });
    droplet
        .command("destroy")
        .alias("shutdown")
        .description("Destroy the active managed droplet")
        .requiredOption("--yes", "confirm that the active droplet should be destroyed")
        .action(async (options) => {
        const globals = getGlobals(program);
        const result = await destroyDroplet(createContext(globals).config, { yes: options.yes });
        write(globals, result, formatDropletDestroyed(result));
    });
    return program;
}
function getGlobals(program) {
    return program.optsWithGlobals();
}
function createContext(options) {
    return createCommandContext(path.resolve(options.cwd), { dryRun: options.dryRun });
}
async function resolvePrompt(globals, prompt, promptFile) {
    if (promptFile && prompt) {
        throw new Error("Pass either a prompt argument or --prompt-file, not both.");
    }
    if (promptFile === "-") {
        return readStdin();
    }
    if (promptFile) {
        return fs.promises.readFile(path.resolve(globals.cwd, promptFile), "utf8");
    }
    if (prompt) {
        return prompt;
    }
    throw new Error("Pass a prompt argument or --prompt-file <path>.");
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}
async function startTask(globals, prompt, options) {
    let context = createContext(globals);
    if (options.create !== false && context.config.digitalOcean.token) {
        const refresh = await refreshManagedDroplet(context.config);
        if (refresh.staleCleared) {
            write(globals, refresh, `cleared stale managed droplet state (${refresh.staleDroplet?.id})`);
            context = createContext(globals);
        }
    }
    if (options.create !== false && !context.config.remote.host) {
        const created = await createDroplet(context.config);
        write(globals, created, formatDropletCreated(created));
        context = createContext(globals);
    }
    const digest = await pushProject(context);
    write(globals, { digest }, `pushed workspace manifest ${digest}`);
    if (!options.skipUp) {
        await upDevcontainer(context);
        write(globals, { ok: true }, "remote devcontainer is ready");
    }
    const result = await runTask(context, prompt, { taskId: options.taskId });
    write(globals, result, `started ${result.sessionName}\nlog: ${result.logFile}`);
}
async function finishTask(globals, options) {
    const context = createContext(globals);
    const digest = await pullProject(context);
    write(globals, { digest }, `pulled workspace manifest ${digest}`);
    if (!options.keepDroplet) {
        const result = await destroyDroplet(context.config, { yes: true });
        write(globals, result, formatDropletDestroyed(result));
    }
}
function write(options, value, text) {
    if (options.json) {
        console.log(JSON.stringify(value, null, 2));
    }
    else {
        console.log(text);
    }
}
function formatDoctor(result) {
    return result.checks
        .map((check) => `${check.ok ? "ok" : "fail"}  ${check.name}: ${check.detail}`)
        .join("\n");
}
function parseInteger(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Expected a positive integer, got ${value}`);
    }
    return parsed;
}
function parseImage(value) {
    if (!value) {
        return undefined;
    }
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : value;
}
function formatDropletCreated(result) {
    return [
        `droplet ${result.dropletId} (${result.name}) is ready`,
        `ip: ${result.ip}`,
        `region: ${result.region}`,
        `size: ${result.size}`,
        `bootstrapped: ${result.bootstrapped ? "yes" : "no"}`
    ].join("\n");
}
function formatDropletDestroyed(result) {
    return result.alreadyMissing
        ? `droplet ${result.dropletId} was already missing; local state cleared`
        : `droplet ${result.dropletId} destroyed`;
}
//# sourceMappingURL=program.js.map