import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { bootstrap } from "./commands/bootstrap.js";
import { createDroplet, dropletStatus, destroyDroplet, refreshManagedDroplet } from "./commands/droplet.js";
import { doctor } from "./commands/doctor.js";
import { initProject } from "./commands/init.js";
import { pullProject, pushProject } from "./commands/sync.js";
import { attachTask, runTask, stopTask, taskLogs, taskStatus } from "./commands/tasks.js";
import { telemetryAutostartInstall, telemetryAutostartStatus, telemetryFlush, telemetryProcessOnce, telemetryProcessorRebuild, telemetryProcessorService, telemetryProcessorStart, telemetryProcessorStatus, telemetryProcessorStop, telemetryService, telemetryStart, telemetryStatus, telemetryStop } from "./commands/telemetry.js";
import { upDevcontainer } from "./commands/up.js";
import { createCommandContext } from "./context.js";
import { DashboardLaunchError } from "./commands/dashboard.js";
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
        .option("--no-telemetry-autostart", "do not install the devcontainer telemetry startup hook")
        .action(async (options) => {
        const globals = getGlobals(program);
        const result = await initProject(path.resolve(globals.cwd), options);
        write(globals, result, formatInitResult(result));
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
        write(globals, result, formatTaskStarted(result));
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
    const telemetry = program
        .command("telemetry")
        .description("Manage local Codex/workspace telemetry uploads");
    telemetry
        .command("start")
        .description("Start the local telemetry background service")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryStart(createContext(globals));
        write(globals, result, result.message);
    });
    const telemetryAutostart = telemetry
        .command("autostart")
        .description("Install or inspect devcontainer telemetry autostart");
    telemetryAutostart
        .command("install")
        .description("Install the devcontainer postStartCommand hook for local telemetry")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryAutostartInstall(createContext(globals));
        write(globals, result, formatTelemetryAutostart(result));
    });
    telemetryAutostart
        .command("status")
        .description("Show whether devcontainer telemetry autostart is installed")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryAutostartStatus(createContext(globals));
        write(globals, result, formatTelemetryAutostart(result));
    });
    telemetry
        .command("stop")
        .description("Stop the local telemetry background service")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryStop(createContext(globals));
        write(globals, result, result.message);
    });
    telemetry
        .command("status")
        .description("Show local telemetry service and cursor state")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryStatus(createContext(globals));
        write(globals, result, formatTelemetryStatus(result));
    });
    telemetry
        .command("flush")
        .description("Upload one local telemetry batch now")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryFlush(createContext(globals));
        write(globals, result, formatTelemetryFlush(result));
    });
    telemetry
        .command("process-once")
        .description("Process pending raw telemetry into dashboard read models once")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryProcessOnce(createContext(globals));
        write(globals, result, formatProcessorRun(result));
    });
    const processor = telemetry
        .command("processor")
        .description("Manage processed telemetry background processing");
    processor
        .command("start")
        .description("Start the local processor wake loop")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryProcessorStart(createContext(globals));
        write(globals, result, result.message);
    });
    processor
        .command("stop")
        .description("Stop the local processor wake loop")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryProcessorStop(createContext(globals));
        write(globals, result, result.message);
    });
    processor
        .command("status")
        .description("Show processor lease, cursor, model mode, and errors")
        .action(async () => {
        const globals = getGlobals(program);
        const result = await telemetryProcessorStatus(createContext(globals));
        write(globals, result, formatProcessorStatus(result));
    });
    processor
        .command("rebuild")
        .description("Clear processed outputs for a bounded scope and rebuild from raw chunks")
        .option("--stream-kind <kind>", "rebuild one stream kind, such as runner-job or codex-thread")
        .option("--stream-id <id>", "rebuild one stream id")
        .option("--project", "rebuild the current project processed read models", true)
        .action(async (options) => {
        const globals = getGlobals(program);
        const scope = options.streamKind && options.streamId
            ? { streamKind: options.streamKind, streamId: options.streamId }
            : { project: Boolean(options.project) };
        const result = await telemetryProcessorRebuild(createContext(globals), scope);
        write(globals, result, formatProcessorRun(result));
    });
    processor
        .command("service", { hidden: true })
        .description("Run the local telemetry processor wake loop")
        .action(async () => {
        await telemetryProcessorService(createContext(getGlobals(program)));
    });
    telemetry
        .command("service", { hidden: true })
        .description("Run the local telemetry service loop")
        .action(async () => {
        await telemetryService(createContext(getGlobals(program)));
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
    let createdManagedDroplet = false;
    if (options.create !== false && context.config.digitalOcean.token) {
        const refresh = await refreshManagedDroplet(context.config);
        if (refresh.staleCleared) {
            write(globals, refresh, `cleared stale managed droplet state (${refresh.staleDroplet?.id})`);
            context = createContext(globals);
        }
    }
    if (options.create !== false && !context.config.remote.host) {
        const created = await createDroplet(context.config);
        createdManagedDroplet = true;
        write(globals, created, formatDropletCreated(created));
        context = createContext(globals);
    }
    try {
        const digest = await pushProject(context);
        write(globals, { digest }, `pushed workspace manifest ${digest}`);
        if (!options.skipUp) {
            await upDevcontainer(context);
            write(globals, { ok: true }, "remote devcontainer is ready");
        }
        const result = await runTask(context, prompt, { taskId: options.taskId });
        write(globals, result, formatTaskStarted(result));
    }
    catch (error) {
        if (createdManagedDroplet && error instanceof DashboardLaunchError) {
            const destroyed = await destroyDroplet(context.config, { yes: true });
            write(globals, destroyed, formatDropletDestroyed(destroyed));
        }
        throw error;
    }
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
function formatInitResult(result) {
    const lines = [result.created ? `created ${result.path}` : `${result.path} already exists`];
    if (result.telemetryAutostart) {
        lines.push(formatTelemetryAutostart(result.telemetryAutostart));
    }
    return lines.join("\n");
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
function formatTaskStarted(result) {
    const lines = [`started ${result.sessionName}`, `log: ${result.logFile}`];
    if (result.dashboardObserver?.sessionName) {
        lines.push(`dashboard observer: ${result.dashboardObserver.sessionName}`);
        if (result.dashboardObserver.summaryFile) {
            lines.push(`dashboard summary: ${result.dashboardObserver.summaryFile}`);
        }
    }
    else if (result.dashboardObserver?.error) {
        lines.push(`dashboard observer failed: ${result.dashboardObserver.error}`);
    }
    return lines.join("\n");
}
function formatTelemetryStatus(result) {
    return [
        `state: ${result.statePath}`,
        `running: ${result.running ? "yes" : "no"}`,
        result.pid ? `pid: ${result.pid}` : "",
        result.lastUploadTime ? `last upload: ${result.lastUploadTime}` : "last upload: never",
        `streams: ${result.knownStreams?.length ?? 0}`
    ].filter(Boolean).join("\n");
}
function formatTelemetryFlush(result) {
    return [
        `uploaded: ${result.uploaded}`,
        `skipped: ${result.skipped}`,
        `state: ${result.statePath}`
    ].join("\n");
}
function formatTelemetryAutostart(result) {
    if (!result.exists) {
        return `telemetry autostart skipped: ${result.reason}`;
    }
    if (!result.installed) {
        return `telemetry autostart not installed: ${result.reason}`;
    }
    return result.changed
        ? `telemetry autostart installed in ${result.path}`
        : `telemetry autostart already installed in ${result.path}`;
}
function formatProcessorRun(result) {
    return [
        `processor: ${result.status || (result.ok ? "completed" : "blocked")}`,
        result.runId ? `run: ${result.runId}` : "",
        result.ownerId ? `owner: ${result.ownerId}` : "",
        typeof result.streamsUpdated === "number" ? `streams updated: ${result.streamsUpdated}` : "",
        typeof result.chunksProcessed === "number" ? `chunks processed: ${result.chunksProcessed}` : "",
        typeof result.memoriesUpdated === "number" ? `memories updated: ${result.memoriesUpdated}` : "",
        result.lease && typeof result.lease === "object" ? `lease owner: ${result.lease.ownerId || "unknown"}` : "",
        Array.isArray(result.errors) && result.errors.length ? `errors: ${result.errors.join("; ")}` : ""
    ].filter(Boolean).join("\n");
}
function formatProcessorStatus(result) {
    const remote = result.remote && typeof result.remote === "object" ? result.remote : {};
    const lease = remote.lease || null;
    const cursor = remote.cursor || {};
    const lastRun = remote.lastRun || null;
    const warnings = Array.isArray(remote.warnings) ? remote.warnings : [];
    return [
        `local running: ${result.local.running ? "yes" : "no"}`,
        result.local.pid ? `local pid: ${result.local.pid}` : "",
        result.local.lastProcessAt ? `last local process: ${result.local.lastProcessAt}` : "",
        result.local.lastError ? `local error: ${result.local.lastError}` : "",
        `lease owner: ${lease?.ownerId || "none"}`,
        lease?.expiresAt ? `lease expires: ${lease.expiresAt}${lease.expired ? " (expired)" : ""}` : "",
        `pending streams: ${cursor.pendingStreamCount ?? "unknown"}`,
        `latest raw sequence: ${cursor.latestRawSequence ?? "unknown"}`,
        `latest processed sequence: ${cursor.latestProcessedSequence ?? "unknown"}`,
        `model mode: ${remote.model?.mode || "deterministic-only"}`,
        lastRun ? `last run: ${lastRun.status} ${lastRun.startedAt}` : "last run: none",
        lastRun?.errors?.length ? `last errors: ${lastRun.errors.join("; ")}` : "",
        warnings.length ? `warnings: ${warnings.map((item) => item.message || item.kind).join("; ")}` : "",
        `state: ${result.local.statePath}`
    ].filter(Boolean).join("\n");
}
//# sourceMappingURL=program.js.map