import { z } from "zod";
declare const activeDropletSchema: z.ZodObject<{
    id: z.ZodNumber;
    name: z.ZodString;
    ip: z.ZodString;
    region: z.ZodString;
    size: z.ZodString;
    hourlyPriceUsd: z.ZodOptional<z.ZodNumber>;
    image: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    snapshotSourceId: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
    snapshotSourceName: z.ZodOptional<z.ZodString>;
    user: z.ZodDefault<z.ZodString>;
    sshKeyPath: z.ZodString;
    sshKeyId: z.ZodOptional<z.ZodNumber>;
    createdAt: z.ZodString;
}, z.core.$strip>;
declare const managedSnapshotSchema: z.ZodObject<{
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    name: z.ZodString;
    projectSlug: z.ZodString;
    sourceDropletId: z.ZodOptional<z.ZodNumber>;
    createdAt: z.ZodString;
    role: z.ZodEnum<{
        project: "project";
        previous: "previous";
        final: "final";
    }>;
    sizeGigabytes: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
declare const phaseTimingSchema: z.ZodObject<{
    startedAt: z.ZodOptional<z.ZodString>;
    finishedAt: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    skipped: z.ZodOptional<z.ZodBoolean>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const lifecycleTimingsSchema: z.ZodObject<{
    createRequestToDropletActive: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    dropletActiveToSshReady: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    sshReadyToBootstrapComplete: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    projectSyncDuration: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    devcontainerReadyDuration: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    codexAppServerReadyDuration: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    firstTelemetryIngestVisible: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    totalStartCommandToAcceptedJob: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    terminalStateToFinalSnapshotComplete: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    finalSnapshotCompleteToDropletDestroyed: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$catchall<z.ZodObject<{
    startedAt: z.ZodOptional<z.ZodString>;
    finishedAt: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    skipped: z.ZodOptional<z.ZodBoolean>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>>;
declare const digitalOceanStateSchema: z.ZodDefault<z.ZodObject<{
    version: z.ZodLiteral<1>;
    projectSlug: z.ZodString;
    activeDroplet: z.ZodOptional<z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodString;
        ip: z.ZodString;
        region: z.ZodString;
        size: z.ZodString;
        hourlyPriceUsd: z.ZodOptional<z.ZodNumber>;
        image: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
        snapshotSourceId: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
        snapshotSourceName: z.ZodOptional<z.ZodString>;
        user: z.ZodDefault<z.ZodString>;
        sshKeyPath: z.ZodString;
        sshKeyId: z.ZodOptional<z.ZodNumber>;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
    projectSnapshot: z.ZodOptional<z.ZodObject<{
        id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
        name: z.ZodString;
        projectSlug: z.ZodString;
        sourceDropletId: z.ZodOptional<z.ZodNumber>;
        createdAt: z.ZodString;
        role: z.ZodEnum<{
            project: "project";
            previous: "previous";
            final: "final";
        }>;
        sizeGigabytes: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    previousSnapshot: z.ZodOptional<z.ZodObject<{
        id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
        name: z.ZodString;
        projectSlug: z.ZodString;
        sourceDropletId: z.ZodOptional<z.ZodNumber>;
        createdAt: z.ZodString;
        role: z.ZodEnum<{
            project: "project";
            previous: "previous";
            final: "final";
        }>;
        sizeGigabytes: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    lastFinalSnapshot: z.ZodOptional<z.ZodObject<{
        id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
        name: z.ZodString;
        projectSlug: z.ZodString;
        sourceDropletId: z.ZodOptional<z.ZodNumber>;
        createdAt: z.ZodString;
        role: z.ZodEnum<{
            project: "project";
            previous: "previous";
            final: "final";
        }>;
        sizeGigabytes: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    lastStartupTimings: z.ZodOptional<z.ZodObject<{
        createRequestToDropletActive: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        dropletActiveToSshReady: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        sshReadyToBootstrapComplete: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        projectSyncDuration: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        devcontainerReadyDuration: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        codexAppServerReadyDuration: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        firstTelemetryIngestVisible: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        totalStartCommandToAcceptedJob: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        terminalStateToFinalSnapshotComplete: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        finalSnapshotCompleteToDropletDestroyed: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$catchall<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>>;
    lastFinishTimings: z.ZodOptional<z.ZodObject<{
        createRequestToDropletActive: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        dropletActiveToSshReady: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        sshReadyToBootstrapComplete: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        projectSyncDuration: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        devcontainerReadyDuration: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        codexAppServerReadyDuration: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        firstTelemetryIngestVisible: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        totalStartCommandToAcceptedJob: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        terminalStateToFinalSnapshotComplete: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        finalSnapshotCompleteToDropletDestroyed: z.ZodOptional<z.ZodObject<{
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            skipped: z.ZodOptional<z.ZodBoolean>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$catchall<z.ZodObject<{
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        skipped: z.ZodOptional<z.ZodBoolean>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>>;
    lastCleanup: z.ZodOptional<z.ZodObject<{
        deletedSnapshotIds: z.ZodDefault<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>>;
        checkedAt: z.ZodString;
        errors: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    updatedAt: z.ZodString;
}, z.core.$strip>>;
export type ActiveDropletState = z.infer<typeof activeDropletSchema>;
export type ManagedSnapshotState = z.infer<typeof managedSnapshotSchema>;
export type PhaseTimingState = z.infer<typeof phaseTimingSchema>;
export type LifecycleTimingsState = z.infer<typeof lifecycleTimingsSchema>;
export type DigitalOceanState = z.infer<typeof digitalOceanStateSchema>;
export declare function digitalOceanStateDir(): string;
export declare function digitalOceanStateFile(projectSlug: string): string;
export declare function readDigitalOceanStateSync(projectSlug: string): DigitalOceanState | undefined;
export declare function readDigitalOceanState(projectSlug: string): Promise<DigitalOceanState | undefined>;
export declare function writeDigitalOceanState(state: DigitalOceanState): Promise<void>;
export declare function stateWithActiveDroplet(projectSlug: string, activeDroplet: ActiveDropletState, existing?: DigitalOceanState): DigitalOceanState;
export declare function stateWithProjectSnapshot(projectSlug: string, projectSnapshot: ManagedSnapshotState, existing?: DigitalOceanState): DigitalOceanState;
export declare function stateWithLifecycleTimings(projectSlug: string, timings: LifecycleTimingsState, kind: "startup" | "finish", existing?: DigitalOceanState): DigitalOceanState;
export declare function stateWithSnapshotCleanup(projectSlug: string, cleanup: {
    deletedSnapshotIds: Array<string | number>;
    checkedAt: string;
    errors: string[];
}, existing?: DigitalOceanState): DigitalOceanState;
export declare function stateWithFinalSnapshot(projectSlug: string, finalSnapshot: ManagedSnapshotState, existing?: DigitalOceanState): DigitalOceanState;
export declare function stateAfterDestroy(projectSlug: string, existing?: DigitalOceanState): DigitalOceanState;
export {};
