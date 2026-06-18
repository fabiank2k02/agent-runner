import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { collectCodexAccountUsageSnapshot } from "./codex-status.js";
import { wakeTelemetryProcessor } from "./telemetry-processor.js";
export const telemetryStateVersion = 1;
export const defaultLocalTelemetryIntervalSeconds = 15 * 60;
export const maxRawPayloadBytes = 2 * 1024 * 1024;
export const maxInlineJsonBytes = 8 * 1024;
export const maxLogLinesPerChunk = 500;
export const maxCommandOutputSnippetBytes = 16 * 1024;
export const maxPromptBytes = 32 * 1024;
export const redactedSecretMarker = "[REDACTED_SECRET]";
export function redactSecrets(input) {
    let output = String(input || "");
    output = output.replace(/\b(OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|DIGITALOCEAN_TOKEN|DIGITALOCEAN_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN|CLOUDFLARE_TOKEN|GH_TOKEN|GITHUB_TOKEN)\b\s*[:=]\s*["']?[^"'\s,;]+/giu, (_match, name) => `${name}=${redactedSecretMarker}`);
    output = output.replace(/\bDATABASE_URL\s*[:=]\s*["']?[^"'\s,;]+/giu, `DATABASE_URL=${redactedSecretMarker}`);
    output = output.replace(/\b(postgres(?:ql)?:\/\/[^:\s/]+):[^@\s]+@/giu, `$1:${redactedSecretMarker}@`);
    output = output.replace(/\bBearer\s+[a-z0-9._~+/=-]{16,}/giu, `Bearer ${redactedSecretMarker}`);
    output = output.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, redactedSecretMarker);
    output = output.replace(/\b(?:sk|rk|pk|ghp|github_pat|glpat|dop)_[-a-z0-9_]{20,}\b/giu, redactedSecretMarker);
    return output;
}
export function redactValue(value) {
    if (typeof value === "string") {
        return redactSecrets(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item));
    }
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            if (isDeniedSecretKey(key)) {
                result[key] = redactedSecretMarker;
            }
            else {
                result[key] = redactValue(item);
            }
        }
        return result;
    }
    return value;
}
export function sha256Hex(input) {
    return createHash("sha256").update(input).digest("hex");
}
export function truncateUtf8(input, maxBytes) {
    const buffer = Buffer.from(input);
    if (buffer.byteLength <= maxBytes) {
        return { value: input, truncated: false };
    }
    return {
        value: buffer.subarray(0, Math.max(0, maxBytes)).toString("utf8").replace(/\uFFFD$/u, ""),
        truncated: true
    };
}
export function boundRawPayload(payload) {
    const redacted = redactValue(payload);
    const normalized = normalizePayloadLimits(redacted);
    const json = JSON.stringify(normalized);
    const bounded = truncateUtf8(json, maxRawPayloadBytes);
    if (!bounded.truncated) {
        return { payload: normalized, truncated: Boolean(normalized.truncated) };
    }
    return {
        payload: {
            truncated: true,
            truncationReason: "max_uncompressed_payload_bytes",
            preview: bounded.value
        },
        truncated: true,
        truncationReason: "max_uncompressed_payload_bytes"
    };
}
export function makeRawTelemetryEnvelope(input) {
    const bounded = boundRawPayload(input.payload ?? {});
    return {
        version: 1,
        kind: "raw-telemetry",
        sourceKind: input.sourceKind,
        sourceId: input.sourceId || defaultSourceId(input.sourceKind, input.projectSlug),
        streamKind: input.streamKind,
        projectSlug: input.projectSlug,
        streamId: input.streamId,
        sequence: input.sequence,
        generatedAt: input.generatedAt || new Date().toISOString(),
        cursor: input.cursor ?? {},
        metadata: redactValue(input.metadata ?? {}),
        payload: bounded.payload,
        ...(bounded.truncated ? { truncated: true, truncationReason: bounded.truncationReason } : {})
    };
}
export function localTelemetryStateDir(projectSlug) {
    return path.join(os.homedir(), ".agent-runner", "telemetry", projectSlug);
}
export function localTelemetryStatePath(projectSlug) {
    return path.join(localTelemetryStateDir(projectSlug), "state.json");
}
export function localTelemetryLogPath(projectSlug) {
    return path.join(localTelemetryStateDir(projectSlug), "service.log");
}
export async function readLocalTelemetryState(projectSlug, statePath = localTelemetryStatePath(projectSlug)) {
    try {
        const raw = await fs.promises.readFile(statePath, "utf8");
        const parsed = JSON.parse(raw);
        return {
            version: 1,
            projectSlug,
            lastStreamSequence: Number.isInteger(parsed.lastStreamSequence) ? parsed.lastStreamSequence : 0,
            knownStreams: Array.isArray(parsed.knownStreams) ? parsed.knownStreams.filter((item) => typeof item === "string") : [],
            streams: parsed.streams && typeof parsed.streams === "object" ? parsed.streams : {},
            lastUploadedChunkHashes: parsed.lastUploadedChunkHashes && typeof parsed.lastUploadedChunkHashes === "object" ? parsed.lastUploadedChunkHashes : {},
            lastUploadTime: parsed.lastUploadTime,
            lastGitHead: parsed.lastGitHead,
            pid: parsed.pid,
            startedAt: parsed.startedAt,
            updatedAt: parsed.updatedAt || new Date().toISOString()
        };
    }
    catch {
        return {
            version: 1,
            projectSlug,
            lastStreamSequence: 0,
            knownStreams: [],
            streams: {},
            lastUploadedChunkHashes: {},
            updatedAt: new Date().toISOString()
        };
    }
}
export async function writeLocalTelemetryState(state, statePath = localTelemetryStatePath(state.projectSlug)) {
    const updated = { ...state, updatedAt: new Date().toISOString() };
    try {
        await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
        await fs.promises.writeFile(statePath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
    }
    catch {
        const fallback = repoLocalTelemetryStatePath(state.projectSlug);
        await fs.promises.mkdir(path.dirname(fallback), { recursive: true });
        await fs.promises.writeFile(fallback, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
    }
}
export class WorkspaceTelemetryAdapter {
    projectRoot;
    projectSlug;
    denyGlobs;
    kind = "local-workspace";
    constructor(projectRoot, projectSlug, denyGlobs = []) {
        this.projectRoot = projectRoot;
        this.projectSlug = projectSlug;
        this.denyGlobs = denyGlobs;
    }
    async discover() {
        return [
            {
                id: `workspace-${this.projectSlug}`,
                kind: "workspace",
                sourceKind: this.kind,
                title: this.projectSlug,
                metadata: {
                    projectRoot: this.projectRoot
                }
            }
        ];
    }
    async readDelta(_stream, cursor) {
        const [head, branch, status] = await Promise.all([
            git(this.projectRoot, ["rev-parse", "HEAD"]),
            git(this.projectRoot, ["branch", "--show-current"]),
            git(this.projectRoot, ["status", "--porcelain=v1", "--branch"])
        ]);
        const dirtyFiles = parseDirtyFiles(status.stdout, this.denyGlobs).slice(0, 80);
        const currentHead = head.stdout || null;
        const lastGitHead = typeof cursor?.gitHead === "string" ? cursor.gitHead : null;
        return {
            cursor: {
                gitHead: currentHead,
                statusHash: sha256Hex(status.stdout)
            },
            metadata: {
                title: this.projectSlug,
                status: dirtyFiles.length ? "active" : "idle",
                latestActivity: dirtyFiles.length ? `${dirtyFiles.length} changed files in workspace` : "Workspace clean or unchanged"
            },
            payload: {
                sourceKind: this.kind,
                workspace: {
                    projectSlug: this.projectSlug,
                    projectRoot: this.projectRoot,
                    branch: branch.stdout || null,
                    gitHead: currentHead,
                    gitHeadChanged: Boolean(currentHead && currentHead !== lastGitHead),
                    dirtyFileCount: dirtyFiles.length,
                    dirtyFiles,
                    statusSummary: truncateUtf8(redactSecrets(status.stdout), maxCommandOutputSnippetBytes).value
                }
            }
        };
    }
}
export class CodexCliSessionAdapter {
    options;
    kind = "codex-cli-thread";
    constructor(options) {
        this.options = options;
    }
    async discover() {
        const codexHome = this.codexHome();
        const sessionsDir = path.join(codexHome, "sessions");
        const files = await listJsonlFiles(sessionsDir, 300, this.options.denyGlobs ?? []);
        return files.map((file) => {
            const relative = path.relative(sessionsDir, file);
            return {
                id: stableStreamId(relative.replace(/\.jsonl$/u, "")),
                kind: "codex-thread",
                sourceKind: this.kind,
                title: path.basename(file, ".jsonl"),
                filePath: file,
                metadata: {
                    relativePath: relative
                }
            };
        });
    }
    async readDelta(stream, cursor) {
        if (!stream.filePath || isDeniedLocalTelemetryPath(stream.filePath, this.options.denyGlobs)) {
            return { cursor: cursor ?? {}, payload: {}, isEmpty: true };
        }
        const stat = await fs.promises.stat(stream.filePath).catch(() => null);
        if (!stat?.isFile()) {
            return { cursor: cursor ?? {}, payload: {}, isEmpty: true };
        }
        const previousOffset = typeof cursor?.fileOffset === "number" && cursor.fileOffset >= 0 ? cursor.fileOffset : 0;
        const start = Math.min(previousOffset, stat.size);
        const bytesToRead = Math.min(maxRawPayloadBytes, stat.size - start);
        const handle = await fs.promises.open(stream.filePath, "r");
        try {
            const buffer = Buffer.alloc(bytesToRead);
            const read = await handle.read(buffer, 0, bytesToRead, start);
            const raw = buffer.subarray(0, read.bytesRead).toString("utf8");
            const boundedLines = raw.split(/\r?\n/u).filter(Boolean).slice(-maxLogLinesPerChunk);
            const redactedLines = boundedLines.map((line) => redactSecrets(line));
            const events = summarizeCodexJsonl(redactedLines);
            const truncated = stat.size - start > bytesToRead || raw.split(/\r?\n/u).filter(Boolean).length > maxLogLinesPerChunk;
            return {
                cursor: {
                    fileOffset: start + read.bytesRead,
                    fileSize: stat.size,
                    mtimeMs: stat.mtimeMs
                },
                metadata: {
                    title: events.title || stream.title,
                    status: events.status,
                    latestActivity: events.latestActivity,
                    tokenUsage: events.tokenUsage,
                    startedAt: events.startedAt,
                    updatedAt: events.updatedAt
                },
                payload: {
                    sourceKind: this.kind,
                    thread: {
                        id: stream.id,
                        title: events.title || stream.title,
                        path: stream.metadata?.relativePath ?? path.basename(stream.filePath),
                        status: events.status,
                        startedAt: events.startedAt,
                        updatedAt: events.updatedAt,
                        promptSnippets: events.promptSnippets,
                        agentMessageSnippets: events.agentMessageSnippets,
                        commandEvents: events.commandEvents,
                        files: events.files,
                        tokenUsage: events.tokenUsage
                    },
                    codexJsonl: {
                        lineCount: redactedLines.length,
                        lines: redactedLines,
                        truncated
                    }
                }
            };
        }
        finally {
            await handle.close();
        }
    }
    codexHome() {
        return this.options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    }
}
export class SimulatedIdeThreadAdapter {
    projectSlug;
    streams;
    kind = "codex-ide-thread";
    constructor(projectSlug, streams = []) {
        this.projectSlug = projectSlug;
        this.streams = streams;
    }
    async discover() {
        return this.streams.map((stream) => ({
            id: stream.id,
            kind: "codex-thread",
            sourceKind: this.kind,
            title: stream.title
        }));
    }
    async readDelta(stream, cursor) {
        const sequence = typeof cursor?.sequence === "number" ? cursor.sequence + 1 : 1;
        const item = this.streams.find((candidate) => candidate.id === stream.id);
        return {
            cursor: { sequence },
            metadata: {
                title: stream.title,
                status: "active",
                latestActivity: item?.activity || "Simulated IDE thread activity"
            },
            payload: {
                sourceKind: this.kind,
                projectSlug: this.projectSlug,
                thread: {
                    id: stream.id,
                    title: stream.title,
                    status: "active",
                    latestActivity: item?.activity || "Simulated IDE thread activity"
                }
            }
        };
    }
}
export class CodexAccountStatusAdapter {
    projectSlug;
    kind = "local-workspace";
    constructor(projectSlug) {
        this.projectSlug = projectSlug;
    }
    async discover() {
        return [
            {
                id: `account-usage-${this.projectSlug}`,
                kind: "workspace",
                sourceKind: this.kind,
                title: "Codex account usage"
            }
        ];
    }
    async readDelta(_stream, cursor) {
        const snapshot = await collectCodexAccountUsageSnapshot();
        if (!snapshot) {
            return { cursor: cursor ?? {}, payload: {}, isEmpty: true };
        }
        const snapshotHash = sha256Hex(JSON.stringify(snapshot));
        if (cursor?.snapshotHash === snapshotHash) {
            return { cursor, payload: {}, isEmpty: true };
        }
        return {
            generatedAt: snapshot.collectedAt,
            cursor: {
                snapshotHash,
                collectedAt: snapshot.collectedAt
            },
            metadata: {
                title: "Codex account usage",
                status: "observed",
                latestActivity: "Codex account usage snapshot collected"
            },
            payload: {
                sourceKind: this.kind,
                accountUsage: snapshot
            }
        };
    }
}
export function createDefaultLocalTelemetryAdapters(context) {
    return [
        new WorkspaceTelemetryAdapter(context.config.projectRoot, context.config.projectSlug, context.config.telemetry.denyGlobs),
        new CodexCliSessionAdapter({
            projectRoot: context.config.projectRoot,
            projectSlug: context.config.projectSlug,
            denyGlobs: context.config.telemetry.denyGlobs
        }),
        new CodexAccountStatusAdapter(context.config.projectSlug)
    ];
}
export async function flushLocalTelemetry(context, options = {}) {
    requireDashboardTelemetryConfig(context);
    const statePath = options.statePath || localTelemetryStatePath(context.config.projectSlug);
    const state = await readLocalTelemetryState(context.config.projectSlug, statePath);
    const adapters = options.adapters ?? createDefaultLocalTelemetryAdapters(context);
    const streams = [];
    let uploaded = 0;
    let skipped = 0;
    for (const adapter of adapters) {
        const discovered = await adapter.discover();
        for (const stream of discovered) {
            const streamKey = localStreamKey(adapter.kind, stream.id);
            const streamState = state.streams[streamKey] ?? { sequence: 0 };
            const delta = await adapter.readDelta(stream, streamState.cursor);
            if (delta.isEmpty) {
                skipped += 1;
                streams.push({
                    id: stream.id,
                    sourceKind: adapter.kind,
                    streamKind: stream.kind,
                    sequence: streamState.sequence,
                    uploaded: false,
                    reason: "empty"
                });
                continue;
            }
            const deltaHash = sha256Hex(JSON.stringify({ cursor: delta.cursor, metadata: delta.metadata ?? {}, payload: delta.payload }));
            if (!options.force && streamState.lastHash === deltaHash) {
                skipped += 1;
                streamState.cursor = delta.cursor;
                state.streams[streamKey] = streamState;
                streams.push({
                    id: stream.id,
                    sourceKind: adapter.kind,
                    streamKind: stream.kind,
                    sequence: streamState.sequence,
                    uploaded: false,
                    reason: "unchanged"
                });
                continue;
            }
            const sequence = streamState.sequence + 1;
            const envelope = makeRawTelemetryEnvelope({
                sourceKind: adapter.kind,
                sourceId: defaultSourceId(adapter.kind, context.config.projectSlug),
                streamKind: stream.kind,
                projectSlug: context.config.projectSlug,
                streamId: stream.id,
                sequence,
                generatedAt: delta.generatedAt ?? options.now?.toISOString(),
                cursor: delta.cursor,
                metadata: {
                    ...stream.metadata,
                    ...delta.metadata,
                    workspaceRoot: context.config.projectRoot
                },
                payload: delta.payload
            });
            await uploadRawTelemetryEnvelope(context, envelope);
            uploaded += 1;
            state.lastStreamSequence = Math.max(state.lastStreamSequence, sequence);
            state.lastUploadTime = new Date().toISOString();
            state.lastUploadedChunkHashes[streamKey] = deltaHash;
            state.streams[streamKey] = {
                sequence,
                cursor: delta.cursor,
                lastHash: deltaHash,
                lastUploadedAt: state.lastUploadTime,
                title: stream.title,
                sourceKind: adapter.kind,
                streamKind: stream.kind
            };
            if (!state.knownStreams.includes(streamKey)) {
                state.knownStreams.push(streamKey);
            }
            streams.push({
                id: stream.id,
                sourceKind: adapter.kind,
                streamKind: stream.kind,
                sequence,
                uploaded: true
            });
        }
    }
    const workspaceState = Object.values(state.streams).find((item) => item.sourceKind === "local-workspace");
    if (workspaceState?.cursor && typeof workspaceState.cursor.gitHead === "string") {
        state.lastGitHead = workspaceState.cursor.gitHead;
    }
    await writeLocalTelemetryState(state, statePath);
    if (uploaded > 0) {
        await wakeTelemetryProcessor(context, "local-telemetry-flush").catch(() => null);
    }
    return {
        ok: true,
        statePath,
        uploaded,
        skipped,
        streams
    };
}
export async function uploadRawTelemetryEnvelope(context, envelope) {
    const endpoint = context.config.dashboard.endpoint;
    const token = context.config.dashboard.token;
    if (!endpoint || !token) {
        throw new Error(`Telemetry upload requires AGENT_RUNNER_DASHBOARD_ENDPOINT and ${context.config.dashboard.tokenEnv}.`);
    }
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json"
        },
        body: JSON.stringify(envelope)
    });
    if (!response.ok) {
        throw new Error(`telemetry ingest failed: ${response.status} ${await response.text()}`);
    }
}
export async function localTelemetryStatus(context, options = {}) {
    const statePath = options.statePath || localTelemetryStatePath(context.config.projectSlug);
    const exists = fs.existsSync(statePath);
    const state = await readLocalTelemetryState(context.config.projectSlug, statePath);
    const running = state.pid ? isProcessRunning(state.pid) : false;
    return {
        statePath,
        exists,
        running,
        pid: state.pid,
        lastUploadTime: state.lastUploadTime,
        lastStreamSequence: state.lastStreamSequence,
        knownStreams: state.knownStreams,
        updatedAt: state.updatedAt
    };
}
export async function startLocalTelemetryService(context) {
    requireDashboardTelemetryConfig(context);
    const statePath = localTelemetryStatePath(context.config.projectSlug);
    const logPath = localTelemetryLogPath(context.config.projectSlug);
    const state = await readLocalTelemetryState(context.config.projectSlug, statePath);
    if (state.pid && isProcessRunning(state.pid)) {
        return {
            started: false,
            pid: state.pid,
            statePath,
            logPath,
            message: `telemetry service already running (${state.pid})`
        };
    }
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
    const logFd = await fs.promises.open(logPath, "a", 0o600);
    const cliPath = process.argv[1];
    if (!cliPath) {
        throw new Error("Unable to resolve current agent-runner CLI path for telemetry service startup.");
    }
    const child = spawn(process.execPath, [cliPath, "-C", context.config.projectRoot, "telemetry", "service"], {
        detached: true,
        stdio: ["ignore", logFd.fd, logFd.fd],
        env: process.env
    });
    child.unref();
    state.pid = child.pid;
    state.startedAt = new Date().toISOString();
    await writeLocalTelemetryState(state, statePath);
    await logFd.close();
    return {
        started: true,
        pid: child.pid,
        statePath,
        logPath,
        message: `telemetry service started (${child.pid})`
    };
}
export async function stopLocalTelemetryService(context) {
    const statePath = localTelemetryStatePath(context.config.projectSlug);
    const state = await readLocalTelemetryState(context.config.projectSlug, statePath);
    if (!state.pid) {
        return { stopped: false, statePath, message: "telemetry service is not running" };
    }
    const running = isProcessRunning(state.pid);
    if (running) {
        process.kill(state.pid, "SIGTERM");
    }
    const pid = state.pid;
    delete state.pid;
    await writeLocalTelemetryState(state, statePath);
    return {
        stopped: running,
        pid,
        statePath,
        message: running ? `telemetry service stopped (${pid})` : `telemetry service pid ${pid} was not running`
    };
}
export async function runLocalTelemetryService(context) {
    const intervalMs = defaultLocalTelemetryIntervalSeconds * 1000;
    let stopping = false;
    process.on("SIGTERM", () => {
        stopping = true;
    });
    process.on("SIGINT", () => {
        stopping = true;
    });
    while (!stopping) {
        try {
            await flushLocalTelemetry(context, { force: true });
        }
        catch (error) {
            console.error(new Date().toISOString(), error instanceof Error ? error.message : String(error));
        }
        const deadline = Date.now() + intervalMs;
        while (!stopping && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
        }
    }
    try {
        await flushLocalTelemetry(context, { force: true });
    }
    catch {
        // Best-effort shutdown flush only.
    }
}
function requireDashboardTelemetryConfig(context) {
    if (!context.config.dashboard.endpoint || !context.config.dashboard.token) {
        throw new Error(`Telemetry requires AGENT_RUNNER_DASHBOARD_ENDPOINT and ${context.config.dashboard.tokenEnv}.`);
    }
}
function defaultSourceId(sourceKind, projectSlug) {
    const host = process.env.CODESPACE_NAME || os.hostname();
    return `${sourceKind}:${projectSlug}:${host}`;
}
function localStreamKey(sourceKind, streamId) {
    return `${sourceKind}:${streamId}`;
}
function repoLocalTelemetryStatePath(projectSlug) {
    return path.join(process.cwd(), ".agent-runner-local", "telemetry", projectSlug, "state.json");
}
function isDeniedSecretKey(key) {
    return /(^|_)(token|secret|password|private[_-]?key|auth)(_|$)/iu.test(key);
}
function normalizePayloadLimits(value) {
    const normalized = normalizeUnknown(value);
    return normalized && typeof normalized === "object" && !Array.isArray(normalized)
        ? normalized
        : { value: normalized };
}
function normalizeUnknown(value) {
    if (typeof value === "string") {
        return truncateUtf8(value, maxPromptBytes).value;
    }
    if (Array.isArray(value)) {
        return value.slice(0, 500).map((item) => normalizeUnknown(item));
    }
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            if (key === "lines" && Array.isArray(item)) {
                result[key] = item.slice(-maxLogLinesPerChunk).map((line) => normalizeUnknown(line));
            }
            else if (/output|stdout|stderr/iu.test(key) && typeof item === "string") {
                result[key] = truncateUtf8(item, maxCommandOutputSnippetBytes).value;
            }
            else if (/prompt/iu.test(key) && typeof item === "string") {
                result[key] = truncateUtf8(item, maxPromptBytes).value;
            }
            else {
                result[key] = normalizeUnknown(item);
            }
        }
        return result;
    }
    return value;
}
async function listJsonlFiles(root, limit, denyGlobs = []) {
    const result = [];
    async function walk(dir) {
        if (result.length >= limit || isDeniedLocalTelemetryPath(dir, denyGlobs)) {
            return;
        }
        const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (isDeniedLocalTelemetryPath(fullPath, denyGlobs)) {
                continue;
            }
            if (entry.isDirectory()) {
                await walk(fullPath);
            }
            else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
                const stat = await fs.promises.stat(fullPath).catch(() => null);
                result.push({ file: fullPath, mtimeMs: stat?.mtimeMs ?? 0 });
            }
            if (result.length >= limit) {
                break;
            }
        }
    }
    await walk(root);
    return result.sort((left, right) => right.mtimeMs - left.mtimeMs).map((item) => item.file);
}
export function isDeniedLocalTelemetryPath(input, denyGlobs = []) {
    const normalized = input.replace(/\\/gu, "/").toLowerCase();
    const builtIn = [
        "/.codex/auth.json",
        "/.ssh/",
        "/.env",
        "/node_modules/",
        "/.git/",
        "/auth.json",
        "/credentials",
        "/token"
    ].some((part) => normalized.includes(part));
    return builtIn || denyGlobs.some((glob) => globMatches(glob, input));
}
function summarizeCodexJsonl(lines) {
    const promptSnippets = [];
    const agentMessageSnippets = [];
    const commandEvents = [];
    const files = new Set();
    const tokenUsage = {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0
    };
    let startedAt = null;
    let updatedAt = null;
    let latestActivity = "Codex CLI session observed";
    let status = "active";
    for (const line of lines) {
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
            continue;
        }
        const timestamp = typeof event?.timestamp === "string" ? event.timestamp : null;
        startedAt = startedAt || timestamp;
        updatedAt = timestamp || updatedAt;
        const type = typeof event?.type === "string" ? event.type : "";
        const item = event?.item && typeof event.item === "object" ? event.item : {};
        const text = typeof item.text === "string" ? item.text : typeof event?.text === "string" ? event.text : "";
        if (type.includes("error")) {
            status = "failed";
            latestActivity = "Codex session reported an error";
        }
        if (type === "turn.completed" || type === "response.completed") {
            status = "completed";
            latestActivity = "Codex turn completed";
        }
        if (item.type === "user_message" || type === "user_message") {
            promptSnippets.push(truncateUtf8(text, 800).value);
            latestActivity = "User prompt recorded";
        }
        if (item.type === "agent_message" || type === "agent_message") {
            agentMessageSnippets.push(truncateUtf8(text, 800).value);
            latestActivity = truncateUtf8(text, 140).value || latestActivity;
        }
        if (typeof item.command === "string" || item.type === "command_execution") {
            commandEvents.push({
                command: truncateUtf8(item.command || "", 500).value,
                timestamp,
                status: item.status || null
            });
            latestActivity = `Command: ${truncateUtf8(item.command || "", 120).value}`;
        }
        collectFileReferences(event, files);
        const usage = event?.usage ?? event?.response?.usage;
        if (usage && typeof usage === "object") {
            tokenUsage.inputTokens += finiteNumber(usage.input_tokens ?? usage.inputTokens);
            tokenUsage.cachedInputTokens += finiteNumber(usage.cached_input_tokens ?? usage.cachedInputTokens);
            tokenUsage.outputTokens += finiteNumber(usage.output_tokens ?? usage.outputTokens);
            tokenUsage.reasoningOutputTokens += finiteNumber(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens);
        }
    }
    tokenUsage.totalTokens = tokenUsage.inputTokens + tokenUsage.outputTokens;
    return {
        title: promptSnippets[0] ? truncateUtf8(promptSnippets[0], 120).value : undefined,
        status,
        latestActivity,
        promptSnippets: promptSnippets.slice(-8),
        agentMessageSnippets: agentMessageSnippets.slice(-12),
        commandEvents: commandEvents.slice(-20),
        files: Array.from(files).slice(0, 120),
        tokenUsage,
        startedAt,
        updatedAt
    };
}
function collectFileReferences(value, files) {
    if (!value || files.size >= 120) {
        return;
    }
    if (typeof value === "string") {
        if (/^[./~]?[a-z0-9_.@/-]+\.[a-z0-9]+$/iu.test(value) && !isDeniedLocalTelemetryPath(value)) {
            files.add(value);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value.slice(0, 200)) {
            collectFileReferences(item, files);
        }
        return;
    }
    if (typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            if (/path|file/iu.test(key) && typeof item === "string" && !isDeniedLocalTelemetryPath(item)) {
                files.add(item);
            }
            else {
                collectFileReferences(item, files);
            }
        }
    }
}
function stableStreamId(input) {
    const normalized = input.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 120);
    return normalized || sha256Hex(input).slice(0, 16);
}
function parseDirtyFiles(status, denyGlobs = []) {
    return status
        .split(/\r?\n/u)
        .filter((line) => line && !line.startsWith("##"))
        .map((line) => ({
        status: line.slice(0, 2).trim() || "unknown",
        path: line.slice(3).trim()
    }))
        .filter((item) => item.path && !isDeniedLocalTelemetryPath(item.path, denyGlobs));
}
function globMatches(glob, input) {
    const normalizedGlob = glob.replace(/\\/gu, "/");
    const normalizedInput = input.replace(/\\/gu, "/");
    const escaped = normalizedGlob
        .replace(/\*\*/gu, "\u0000")
        .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
        .replace(/\*/gu, "[^/]*")
        .replace(/\?/gu, ".")
        .replace(/\u0000/gu, ".*");
    return new RegExp(`(^|/)${escaped}($|/)`, "iu").test(normalizedInput) || new RegExp(`^${escaped}$`, "iu").test(normalizedInput);
}
async function git(cwd, args) {
    try {
        const result = await execa("git", args, { cwd, reject: false });
        return { stdout: result.exitCode === 0 ? result.stdout.trim() : "" };
    }
    catch {
        return { stdout: "" };
    }
}
function finiteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
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
//# sourceMappingURL=telemetry.js.map