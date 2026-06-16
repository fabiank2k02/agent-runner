import type { ResolvedConfig } from "./config.js";
import { type CommandResult, type ShellExecutor } from "./shell.js";
export interface RemoteClient {
    run(command: string, options?: {
        input?: string;
        tty?: boolean;
    }): Promise<CommandResult>;
    writeText(remotePath: string, content: string, mode?: string): Promise<void>;
    readText(remotePath: string): Promise<string>;
    interactive(command: string): Promise<CommandResult>;
}
export declare function remoteTarget(config: ResolvedConfig): string;
export declare function buildSshArgs(config: ResolvedConfig, command?: string, tty?: boolean): string[];
export interface SshInvocation {
    command: "ssh" | "sshpass";
    args: string[];
    env?: NodeJS.ProcessEnv;
}
export declare function buildSshInvocation(config: ResolvedConfig, command?: string, tty?: boolean): SshInvocation;
export declare class SshRemoteClient implements RemoteClient {
    private readonly config;
    private readonly executor;
    private readonly dryRun;
    constructor(config: ResolvedConfig, executor: ShellExecutor, dryRun?: boolean);
    run(command: string, options?: {
        input?: string;
        tty?: boolean;
    }): Promise<CommandResult>;
    writeText(remotePath: string, content: string, mode?: string): Promise<void>;
    readText(remotePath: string): Promise<string>;
    interactive(command: string): Promise<CommandResult>;
}
