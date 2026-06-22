import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dashboardAuthHeaders, readDashboardJson } from "./dashboard-api.js";
const defaultProcessorIntervalSeconds = 60;
export function dashboardProcessorUrl(endpoint) {
    const url = new URL(endpoint);
    url.pathname = url.pathname.replace(/\/api\/ingest\/?$/u, "/api/processor");
    if (!url.pathname.endsWith("/api/processor")) {
        url.pathname = "/api/processor";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
}
export async function processTelemetryOnce(context, options = {}) {
    const action = options.rebuild ? "rebuild" : "process-once";
    return callProcessor(context, {
        action,
        projectSlug: context.config.projectSlug,
        ownerId: localOwnerId(context, action),
        ...(options.scope ? { scope: options.scope } : {}),
        ...(options.limits ? { limits: options.limits } : {})
    });
}
export async function rebuildTelemetryProcessing(context, scope) {
    return processTelemetryOnce(context, { rebuild: true, scope });
}
export async function wakeTelemetryProcessor(context, reason = "telemetry-upload") {
    if (!context.config.dashboard.endpoint || !context.config.dashboard.token) {
        return null;
    }
    try {
        return await callProcessor(context, {
            action: "wake",
            projectSlug: context.config.projectSlug,
            ownerId: localOwnerId(context, reason),
            limits: {
                maxStreams: 3,
                maxChunks: 24,
                maxR2Bytes: 64 * 1024,
                maxRuntimeMs: 5000,
                leaseSeconds: 30
            }
        });
    }
    catch {
        return null;
    }
}
export async function processorRemoteStatus(context) {
    requireDashboardProcessorConfig(context);
    const url = new URL(dashboardProcessorUrl(context.config.dashboard.endpoint));
    url.searchParams.set("projectSlug", context.config.projectSlug);
    const response = await fetch(url, {
        headers: dashboardAuthHeaders(context.config.dashboard)
    });
    const { body } = await readDashboardJson(response, "processor status");
    if (!response.ok) {
        throw new Error(body?.error || `processor status failed: ${response.status}`);
    }
    return body;
}
export async function processorStatus(context) {
    const statePath = processorStatePath(context.config.projectSlug);
    const exists = fs.existsSync(statePath);
    const state = await readProcessorState(context.config.projectSlug, statePath);
    const remote = await processorRemoteStatus(context).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
    }));
    return {
        local: {
            statePath,
            exists,
            running: state.pid ? isProcessRunning(state.pid) : false,
            pid: state.pid,
            startedAt: state.startedAt,
            lastProcessAt: state.lastProcessAt,
            lastError: state.lastError,
            updatedAt: state.updatedAt
        },
        remote
    };
}
export async function startProcessorService(context) {
    requireDashboardProcessorConfig(context);
    const statePath = processorStatePath(context.config.projectSlug);
    const logPath = processorLogPath(context.config.projectSlug);
    const state = await readProcessorState(context.config.projectSlug, statePath);
    if (state.pid && isProcessRunning(state.pid)) {
        return {
            started: false,
            pid: state.pid,
            statePath,
            logPath,
            message: `processor service already running (${state.pid})`
        };
    }
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
    const logFd = await fs.promises.open(logPath, "a", 0o600);
    const cliPath = process.argv[1];
    if (!cliPath) {
        throw new Error("Unable to resolve current agent-runner CLI path for processor service startup.");
    }
    const child = spawn(process.execPath, [cliPath, "-C", context.config.projectRoot, "telemetry", "processor", "service"], {
        detached: true,
        stdio: ["ignore", logFd.fd, logFd.fd],
        env: process.env
    });
    child.unref();
    state.pid = child.pid;
    state.startedAt = new Date().toISOString();
    delete state.lastError;
    await writeProcessorState(state, statePath);
    await logFd.close();
    return {
        started: true,
        pid: child.pid,
        statePath,
        logPath,
        message: `processor service started (${child.pid})`
    };
}
export async function stopProcessorService(context) {
    const statePath = processorStatePath(context.config.projectSlug);
    const state = await readProcessorState(context.config.projectSlug, statePath);
    if (!state.pid) {
        return { stopped: false, statePath, message: "processor service is not running" };
    }
    const running = isProcessRunning(state.pid);
    if (running) {
        process.kill(state.pid, "SIGTERM");
    }
    const pid = state.pid;
    delete state.pid;
    await writeProcessorState(state, statePath);
    return {
        stopped: running,
        pid,
        statePath,
        message: running ? `processor service stopped (${pid})` : `processor service pid ${pid} was not running`
    };
}
export async function runProcessorService(context) {
    requireDashboardProcessorConfig(context);
    const intervalMs = defaultProcessorIntervalSeconds * 1000;
    const statePath = processorStatePath(context.config.projectSlug);
    let stopping = false;
    process.on("SIGTERM", () => {
        stopping = true;
    });
    process.on("SIGINT", () => {
        stopping = true;
    });
    while (!stopping) {
        const state = await readProcessorState(context.config.projectSlug, statePath);
        try {
            await processTelemetryOnce(context, {
                limits: {
                    maxStreams: 10,
                    maxChunks: 80,
                    maxR2Bytes: 256 * 1024,
                    maxRuntimeMs: 20_000
                }
            });
            state.lastProcessAt = new Date().toISOString();
            delete state.lastError;
        }
        catch (error) {
            state.lastError = error instanceof Error ? error.message : String(error);
            console.error(new Date().toISOString(), state.lastError);
        }
        await writeProcessorState(state, statePath);
        const deadline = Date.now() + intervalMs;
        while (!stopping && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
        }
    }
}
async function callProcessor(context, payload) {
    requireDashboardProcessorConfig(context);
    const response = await fetch(dashboardProcessorUrl(context.config.dashboard.endpoint), {
        method: "POST",
        headers: dashboardAuthHeaders(context.config.dashboard, { contentType: true }),
        body: JSON.stringify(payload)
    });
    const { body } = await readDashboardJson(response, "processor request");
    if (!response.ok) {
        throw new Error(String(body?.error || `processor request failed: ${response.status}`));
    }
    return body;
}
function requireDashboardProcessorConfig(context) {
    if (!context.config.dashboard.endpoint || !hasDashboardAuth(context.config.dashboard)) {
        throw new Error(`Telemetry processor requires AGENT_RUNNER_DASHBOARD_ENDPOINT and either ${context.config.dashboard.tokenEnv} or AGENT_RUNNER_CF_ACCESS_CLIENT_ID/AGENT_RUNNER_CF_ACCESS_CLIENT_SECRET.`);
    }
}
function hasDashboardAuth(dashboard) {
    return Boolean(dashboard.token || (dashboard.accessClientId && dashboard.accessClientSecret));
}
function processorStateDir(projectSlug) {
    return path.join(os.homedir(), ".agent-runner", "telemetry", projectSlug);
}
function processorStatePath(projectSlug) {
    return path.join(processorStateDir(projectSlug), "processor.json");
}
function processorLogPath(projectSlug) {
    return path.join(processorStateDir(projectSlug), "processor.log");
}
async function readProcessorState(projectSlug, statePath = processorStatePath(projectSlug)) {
    try {
        const raw = await fs.promises.readFile(statePath, "utf8");
        const parsed = JSON.parse(raw);
        return {
            version: 1,
            projectSlug,
            pid: parsed.pid,
            startedAt: parsed.startedAt,
            lastProcessAt: parsed.lastProcessAt,
            lastError: parsed.lastError,
            updatedAt: parsed.updatedAt || new Date().toISOString()
        };
    }
    catch {
        return {
            version: 1,
            projectSlug,
            updatedAt: new Date().toISOString()
        };
    }
}
async function writeProcessorState(state, statePath = processorStatePath(state.projectSlug)) {
    const updated = { ...state, updatedAt: new Date().toISOString() };
    await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
    await fs.promises.writeFile(statePath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
}
function localOwnerId(context, reason) {
    const host = process.env.CODESPACE_NAME || os.hostname();
    return `local:${context.config.projectSlug}:${host}:${reason}`.replace(/[^a-zA-Z0-9:._=-]+/gu, "-").slice(0, 180);
}
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=telemetry-processor.js.map