import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ProjectManifest } from "./manifest.js";
import type { RunnerLayout } from "./paths.js";

const taskStateSchema = z.object({
  taskId: z.string(),
  sessionName: z.string(),
  statusFile: z.string(),
  logFile: z.string(),
  promptFile: z.string(),
  startedAt: z.string()
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

export type TaskState = z.infer<typeof taskStateSchema>;
export type LocalState = z.infer<typeof localStateSchema>;

export async function readLocalState(layout: RunnerLayout): Promise<LocalState | undefined> {
  if (!fs.existsSync(layout.localStateFile)) {
    return undefined;
  }
  const raw = await fs.promises.readFile(layout.localStateFile, "utf8");
  return localStateSchema.parse(JSON.parse(raw));
}

export async function writeLocalState(layout: RunnerLayout, state: LocalState): Promise<void> {
  await fs.promises.mkdir(path.dirname(layout.localStateFile), { recursive: true });
  await fs.promises.writeFile(layout.localStateFile, `${JSON.stringify(state, null, 2)}\n`);
}

export function stateFromPush(layout: RunnerLayout, manifest: ProjectManifest, existing?: LocalState): LocalState {
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

export function stateFromPull(layout: RunnerLayout, manifest: ProjectManifest, existing?: LocalState): LocalState {
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

export function stateWithTask(layout: RunnerLayout, task: TaskState, existing?: LocalState): LocalState {
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
