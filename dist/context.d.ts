import { type ResolvedConfig } from "./config.js";
import { type RunnerLayout } from "./paths.js";
import { type RemoteClient } from "./remote.js";
import { type ShellExecutor } from "./shell.js";
export interface CommandContext {
    config: ResolvedConfig;
    layout: RunnerLayout;
    executor: ShellExecutor;
    remote: RemoteClient;
    dryRun: boolean;
}
export declare function createCommandContext(projectRoot: string, options?: {
    dryRun?: boolean;
}): CommandContext;
