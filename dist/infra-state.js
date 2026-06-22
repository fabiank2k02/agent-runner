import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
const activeDropletSchema = z.object({
    id: z.number(),
    name: z.string(),
    ip: z.string(),
    region: z.string(),
    size: z.string(),
    hourlyPriceUsd: z.number().optional(),
    image: z.union([z.string(), z.number()]),
    snapshotSourceId: z.union([z.string(), z.number()]).optional(),
    snapshotSourceName: z.string().optional(),
    user: z.string().default("root"),
    sshKeyPath: z.string(),
    sshKeyId: z.number().optional(),
    createdAt: z.string()
});
const managedSnapshotSchema = z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    projectSlug: z.string(),
    sourceDropletId: z.number().optional(),
    createdAt: z.string(),
    role: z.enum(["project", "previous", "final"]),
    sizeGigabytes: z.number().optional()
});
const phaseTimingSchema = z.object({
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    durationMs: z.number().optional(),
    skipped: z.boolean().optional(),
    error: z.string().optional()
});
const lifecycleTimingsSchema = z
    .object({
    createRequestToDropletActive: phaseTimingSchema.optional(),
    dropletActiveToSshReady: phaseTimingSchema.optional(),
    sshReadyToBootstrapComplete: phaseTimingSchema.optional(),
    projectSyncDuration: phaseTimingSchema.optional(),
    devcontainerReadyDuration: phaseTimingSchema.optional(),
    codexAppServerReadyDuration: phaseTimingSchema.optional(),
    firstTelemetryIngestVisible: phaseTimingSchema.optional(),
    totalStartCommandToAcceptedJob: phaseTimingSchema.optional(),
    terminalStateToFinalSnapshotComplete: phaseTimingSchema.optional(),
    finalSnapshotCompleteToDropletDestroyed: phaseTimingSchema.optional()
})
    .catchall(phaseTimingSchema);
const digitalOceanStateSchema = z
    .object({
    version: z.literal(1),
    projectSlug: z.string(),
    activeDroplet: activeDropletSchema.optional(),
    projectSnapshot: managedSnapshotSchema.optional(),
    previousSnapshot: managedSnapshotSchema.optional(),
    lastFinalSnapshot: managedSnapshotSchema.optional(),
    lastStartupTimings: lifecycleTimingsSchema.optional(),
    lastFinishTimings: lifecycleTimingsSchema.optional(),
    lastCleanup: z
        .object({
        deletedSnapshotIds: z.array(z.union([z.string(), z.number()])).default([]),
        checkedAt: z.string(),
        errors: z.array(z.string()).default([])
    })
        .optional(),
    updatedAt: z.string()
})
    .default({
    version: 1,
    projectSlug: "",
    updatedAt: ""
});
export function digitalOceanStateDir() {
    return path.join(os.homedir(), ".agent-runner", "digitalocean");
}
export function digitalOceanStateFile(projectSlug) {
    return path.join(digitalOceanStateDir(), `${projectSlug}.json`);
}
export function readDigitalOceanStateSync(projectSlug) {
    const stateFile = digitalOceanStateFile(projectSlug);
    if (!fs.existsSync(stateFile)) {
        return undefined;
    }
    const raw = fs.readFileSync(stateFile, "utf8");
    return digitalOceanStateSchema.parse(JSON.parse(raw));
}
export async function readDigitalOceanState(projectSlug) {
    const stateFile = digitalOceanStateFile(projectSlug);
    if (!fs.existsSync(stateFile)) {
        return undefined;
    }
    const raw = await fs.promises.readFile(stateFile, "utf8");
    return digitalOceanStateSchema.parse(JSON.parse(raw));
}
export async function writeDigitalOceanState(state) {
    await fs.promises.mkdir(digitalOceanStateDir(), { recursive: true });
    await fs.promises.writeFile(digitalOceanStateFile(state.projectSlug), `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}
export function stateWithActiveDroplet(projectSlug, activeDroplet, existing) {
    return {
        version: 1,
        projectSlug,
        activeDroplet,
        projectSnapshot: existing?.projectSnapshot,
        previousSnapshot: existing?.previousSnapshot,
        lastFinalSnapshot: existing?.lastFinalSnapshot,
        lastStartupTimings: existing?.lastStartupTimings,
        lastFinishTimings: existing?.lastFinishTimings,
        lastCleanup: existing?.lastCleanup,
        updatedAt: new Date().toISOString()
    };
}
export function stateWithProjectSnapshot(projectSlug, projectSnapshot, existing) {
    return {
        version: 1,
        projectSlug,
        activeDroplet: existing?.activeDroplet,
        projectSnapshot,
        previousSnapshot: existing?.projectSnapshot,
        lastFinalSnapshot: existing?.lastFinalSnapshot,
        lastStartupTimings: existing?.lastStartupTimings,
        lastFinishTimings: existing?.lastFinishTimings,
        lastCleanup: existing?.lastCleanup,
        updatedAt: new Date().toISOString()
    };
}
export function stateWithLifecycleTimings(projectSlug, timings, kind, existing) {
    return {
        version: 1,
        projectSlug,
        activeDroplet: existing?.activeDroplet,
        projectSnapshot: existing?.projectSnapshot,
        previousSnapshot: existing?.previousSnapshot,
        lastFinalSnapshot: existing?.lastFinalSnapshot,
        lastStartupTimings: kind === "startup" ? timings : existing?.lastStartupTimings,
        lastFinishTimings: kind === "finish" ? timings : existing?.lastFinishTimings,
        lastCleanup: existing?.lastCleanup,
        updatedAt: new Date().toISOString()
    };
}
export function stateWithSnapshotCleanup(projectSlug, cleanup, existing) {
    return {
        version: 1,
        projectSlug,
        activeDroplet: existing?.activeDroplet,
        projectSnapshot: existing?.projectSnapshot,
        previousSnapshot: existing?.previousSnapshot,
        lastFinalSnapshot: existing?.lastFinalSnapshot,
        lastStartupTimings: existing?.lastStartupTimings,
        lastFinishTimings: existing?.lastFinishTimings,
        lastCleanup: cleanup,
        updatedAt: new Date().toISOString()
    };
}
export function stateWithFinalSnapshot(projectSlug, finalSnapshot, existing) {
    return {
        version: 1,
        projectSlug,
        activeDroplet: existing?.activeDroplet,
        projectSnapshot: existing?.projectSnapshot,
        previousSnapshot: existing?.previousSnapshot,
        lastFinalSnapshot: finalSnapshot,
        lastStartupTimings: existing?.lastStartupTimings,
        lastFinishTimings: existing?.lastFinishTimings,
        lastCleanup: existing?.lastCleanup,
        updatedAt: new Date().toISOString()
    };
}
export function stateAfterDestroy(projectSlug, existing) {
    return {
        version: 1,
        projectSlug,
        activeDroplet: undefined,
        projectSnapshot: existing?.projectSnapshot,
        previousSnapshot: existing?.previousSnapshot,
        lastFinalSnapshot: existing?.lastFinalSnapshot,
        lastStartupTimings: existing?.lastStartupTimings,
        lastFinishTimings: existing?.lastFinishTimings,
        lastCleanup: existing?.lastCleanup,
        updatedAt: new Date().toISOString()
    };
}
//# sourceMappingURL=infra-state.js.map