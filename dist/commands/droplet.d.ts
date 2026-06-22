import type { ResolvedConfig } from "../config.js";
import { type ActiveDropletState, type DigitalOceanState, type LifecycleTimingsState, type ManagedSnapshotState } from "../infra-state.js";
import { type ShellExecutor } from "../shell.js";
export interface DropletCreateOptions {
    name?: string;
    region?: string;
    size?: string;
    image?: string | number;
    skipBootstrap?: boolean;
    useProjectSnapshot?: boolean;
}
export interface DropletDestroyOptions {
    yes?: boolean;
}
export interface DropletLifecycleResult {
    dropletId: number;
    name: string;
    ip: string;
    region: string;
    size: string;
    image: string | number;
    bootstrapped: boolean;
    snapshotUsed?: boolean;
    snapshotId?: string | number;
    snapshotName?: string;
    snapshotFallbackError?: string;
    timings?: LifecycleTimingsState;
}
export interface DropletDestroyResult {
    dropletId: number;
    destroyed: boolean;
    alreadyMissing?: boolean;
}
export interface ManagedSnapshotResult {
    snapshot: ManagedSnapshotState;
    deletedSnapshotIds: Array<string | number>;
    errors: string[];
}
export interface ManagedDropletRefreshResult {
    active: boolean;
    staleCleared: boolean;
    droplet?: {
        id: number;
        name: string;
        status: string;
        locked: boolean;
        ip?: string;
        region: string;
        size: string;
        hourlyPriceUsd?: number;
    };
    staleDroplet?: ActiveDropletState;
}
export declare function createDroplet(config: ResolvedConfig, options?: DropletCreateOptions, executor?: ShellExecutor): Promise<DropletLifecycleResult>;
export declare function dropletStatus(config: ResolvedConfig): Promise<Record<string, unknown>>;
export declare function destroyDroplet(config: ResolvedConfig, options?: DropletDestroyOptions): Promise<DropletDestroyResult>;
export declare function createFinalProjectSnapshot(config: ResolvedConfig, options?: {
    sourceDropletId?: number;
    name?: string;
}): Promise<ManagedSnapshotResult>;
export declare function cleanupProjectSnapshots(config: ResolvedConfig, options?: {
    state?: DigitalOceanState;
    keepPrevious?: boolean;
}): Promise<{
    deletedSnapshotIds: Array<string | number>;
    errors: string[];
}>;
export declare function refreshManagedDroplet(config: ResolvedConfig): Promise<ManagedDropletRefreshResult>;
