export interface CommandResult {
    command: string;
    args: string[];
    stdout: string;
    stderr: string;
    exitCode: number;
}
export interface RunOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    stdio?: "pipe" | "inherit";
    dryRun?: boolean;
}
export interface ShellExecutor {
    run(command: string, args?: string[], options?: RunOptions): Promise<CommandResult>;
}
export declare class RealShellExecutor implements ShellExecutor {
    run(command: string, args?: string[], options?: RunOptions): Promise<CommandResult>;
}
export declare function formatCommand(command: string, args?: string[]): string;
export declare function requireSuccess(result: Promise<CommandResult>, message: string): Promise<CommandResult>;
