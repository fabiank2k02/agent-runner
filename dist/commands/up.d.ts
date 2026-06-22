import type { CommandContext } from "../context.js";
export interface DevcontainerUpResult {
    devcontainerReadyDurationMs: number;
    codexInstallDurationMs: number;
    codexAppServerReadyDurationMs: number;
}
export declare function upDevcontainer(context: CommandContext): Promise<DevcontainerUpResult>;
