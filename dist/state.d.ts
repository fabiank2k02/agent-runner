import { z } from "zod";
import type { ProjectManifest } from "./manifest.js";
import type { RunnerLayout } from "./paths.js";
declare const taskStateSchema: z.ZodObject<{
    taskId: z.ZodString;
    sessionName: z.ZodString;
    statusFile: z.ZodString;
    logFile: z.ZodString;
    promptFile: z.ZodString;
    startedAt: z.ZodString;
    artifactDirectory: z.ZodOptional<z.ZodString>;
    artifactManifestFile: z.ZodOptional<z.ZodString>;
    dashboardObserverSessionName: z.ZodOptional<z.ZodString>;
    dashboardSummaryFile: z.ZodOptional<z.ZodString>;
    dashboardObserverLogFile: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const localStateSchema: z.ZodDefault<z.ZodObject<{
    version: z.ZodLiteral<1>;
    projectSlug: z.ZodString;
    remoteProjectDir: z.ZodString;
    lastPushedManifest: z.ZodOptional<z.ZodObject<{
        digest: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
    lastPulledManifest: z.ZodOptional<z.ZodObject<{
        digest: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
    lastTask: z.ZodOptional<z.ZodObject<{
        taskId: z.ZodString;
        sessionName: z.ZodString;
        statusFile: z.ZodString;
        logFile: z.ZodString;
        promptFile: z.ZodString;
        startedAt: z.ZodString;
        artifactDirectory: z.ZodOptional<z.ZodString>;
        artifactManifestFile: z.ZodOptional<z.ZodString>;
        dashboardObserverSessionName: z.ZodOptional<z.ZodString>;
        dashboardSummaryFile: z.ZodOptional<z.ZodString>;
        dashboardObserverLogFile: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    updatedAt: z.ZodString;
}, z.core.$strip>>;
export type TaskState = z.infer<typeof taskStateSchema>;
export type LocalState = z.infer<typeof localStateSchema>;
export declare function readLocalState(layout: RunnerLayout): Promise<LocalState | undefined>;
export declare function writeLocalState(layout: RunnerLayout, state: LocalState): Promise<void>;
export declare function stateFromPush(layout: RunnerLayout, manifest: ProjectManifest, existing?: LocalState): LocalState;
export declare function stateFromPull(layout: RunnerLayout, manifest: ProjectManifest, existing?: LocalState): LocalState;
export declare function stateWithTask(layout: RunnerLayout, task: TaskState, existing?: LocalState): LocalState;
export {};
