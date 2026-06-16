import type { ResolvedConfig } from "./config.js";
import { type CommandResult, type ShellExecutor } from "./shell.js";
export type RsyncDirection = "push" | "pull";
export interface RsyncArgsOptions {
    direction: RsyncDirection;
    localProjectRoot: string;
    remoteProjectDir: string;
    dryRun?: boolean;
    extraExcludes?: string[];
}
export declare function buildRsyncArgs(config: ResolvedConfig, options: RsyncArgsOptions): string[];
export declare function runRsync(config: ResolvedConfig, executor: ShellExecutor, options: RsyncArgsOptions): Promise<CommandResult>;
