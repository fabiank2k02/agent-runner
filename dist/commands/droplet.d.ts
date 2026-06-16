import type { ResolvedConfig } from "../config.js";
import { type ShellExecutor } from "../shell.js";
export interface DropletCreateOptions {
    name?: string;
    region?: string;
    size?: string;
    image?: string | number;
    skipBootstrap?: boolean;
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
}
export interface DropletDestroyResult {
    dropletId: number;
    destroyed: boolean;
}
export declare function createDroplet(config: ResolvedConfig, options?: DropletCreateOptions, executor?: ShellExecutor): Promise<DropletLifecycleResult>;
export declare function dropletStatus(config: ResolvedConfig): Promise<Record<string, unknown>>;
export declare function destroyDroplet(config: ResolvedConfig, options?: DropletDestroyOptions): Promise<DropletDestroyResult>;
