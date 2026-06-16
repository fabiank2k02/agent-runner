import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
const taskStateSchema = z.object({
    taskId: z.string(),
    sessionName: z.string(),
    statusFile: z.string(),
    logFile: z.string(),
    promptFile: z.string(),
    startedAt: z.string(),
    dashboardObserverSessionName: z.string().optional(),
    dashboardSummaryFile: z.string().optional(),
    dashboardObserverLogFile: z.string().optional()
});
const localStateSchema = z
    .object({
    version: z.literal(1),
    projectSlug: z.string(),
    remoteProjectDir: z.string(),
    lastPushedManifest: z
        .object({
        digest: z.string(),
        createdAt: z.string()
    })
        .optional(),
    lastPulledManifest: z
        .object({
        digest: z.string(),
        createdAt: z.string()
    })
        .optional(),
    lastTask: taskStateSchema.optional(),
    updatedAt: z.string()
})
    .default({
    version: 1,
    projectSlug: "",
    remoteProjectDir: "",
    updatedAt: ""
});
export async function readLocalState(layout) {
    if (!fs.existsSync(layout.localStateFile)) {
        return undefined;
    }
    const raw = await fs.promises.readFile(layout.localStateFile, "utf8");
    return localStateSchema.parse(JSON.parse(raw));
}
export async function writeLocalState(layout, state) {
    await fs.promises.mkdir(path.dirname(layout.localStateFile), { recursive: true });
    await fs.promises.writeFile(layout.localStateFile, `${JSON.stringify(state, null, 2)}\n`);
}
export function stateFromPush(layout, manifest, existing) {
    return {
        version: 1,
        projectSlug: layout.projectSlug,
        remoteProjectDir: layout.remoteProjectDir,
        lastPushedManifest: {
            digest: manifest.digest,
            createdAt: manifest.createdAt
        },
        lastPulledManifest: existing?.lastPulledManifest,
        lastTask: existing?.lastTask,
        updatedAt: new Date().toISOString()
    };
}
export function stateFromPull(layout, manifest, existing) {
    return {
        version: 1,
        projectSlug: layout.projectSlug,
        remoteProjectDir: layout.remoteProjectDir,
        lastPushedManifest: {
            digest: manifest.digest,
            createdAt: manifest.createdAt
        },
        lastPulledManifest: {
            digest: manifest.digest,
            createdAt: manifest.createdAt
        },
        lastTask: existing?.lastTask,
        updatedAt: new Date().toISOString()
    };
}
export function stateWithTask(layout, task, existing) {
    return {
        version: 1,
        projectSlug: layout.projectSlug,
        remoteProjectDir: layout.remoteProjectDir,
        lastPushedManifest: existing?.lastPushedManifest,
        lastPulledManifest: existing?.lastPulledManifest,
        lastTask: task,
        updatedAt: new Date().toISOString()
    };
}
//# sourceMappingURL=state.js.map