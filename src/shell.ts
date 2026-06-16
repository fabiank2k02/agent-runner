import { execa } from "execa";

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

export class RealShellExecutor implements ShellExecutor {
  async run(command: string, args: string[] = [], options: RunOptions = {}): Promise<CommandResult> {
    if (options.dryRun) {
      return {
        command,
        args,
        stdout: formatCommand(command, args),
        stderr: "",
        exitCode: 0
      };
    }

    const child = execa(command, args, {
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      reject: false,
      stdio: options.stdio ?? "pipe"
    });
    const result = await child;

    return {
      command,
      args,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
      exitCode: result.exitCode ?? 0
    };
  }
}

export function formatCommand(command: string, args: string[] = []): string {
  return [command, ...args].join(" ");
}

export async function requireSuccess(result: Promise<CommandResult>, message: string): Promise<CommandResult> {
  const resolved = await result;
  if (resolved.exitCode !== 0) {
    const details = resolved.stderr || resolved.stdout || `${resolved.command} exited ${resolved.exitCode}`;
    throw new Error(`${message}\n${details}`);
  }
  return resolved;
}
