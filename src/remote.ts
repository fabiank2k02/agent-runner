import { dirnameRemote, quoteRemotePath, shellQuote } from "./quote.js";
import type { ResolvedConfig } from "./config.js";
import { requireSuccess, type CommandResult, type ShellExecutor } from "./shell.js";

export interface RemoteClient {
  run(command: string, options?: { input?: string; tty?: boolean }): Promise<CommandResult>;
  writeText(remotePath: string, content: string, mode?: string): Promise<void>;
  readText(remotePath: string): Promise<string>;
  interactive(command: string): Promise<CommandResult>;
}

export function remoteTarget(config: ResolvedConfig): string {
  if (!config.remote.host || !config.remote.user) {
    throw new Error("Remote host and user are required. Set AGENT_RUNNER_REMOTE_HOST and AGENT_RUNNER_REMOTE_USER.");
  }
  return `${config.remote.user}@${config.remote.host}`;
}

export function buildSshArgs(config: ResolvedConfig, command?: string, tty = false): string[] {
  const args: string[] = [];
  if (tty) {
    args.push("-t");
  }
  args.push("-p", String(config.remote.port));

  if (config.remote.password) {
    args.push(
      "-o",
      "PreferredAuthentications=password",
      "-o",
      "PubkeyAuthentication=no",
      "-o",
      "StrictHostKeyChecking=accept-new"
    );
  } else if (config.remote.sshKey) {
    args.push("-i", config.remote.sshKey);
  }

  args.push(remoteTarget(config));
  if (command) {
    args.push(command);
  }
  return args;
}

export interface SshInvocation {
  command: "ssh" | "sshpass";
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export function buildSshInvocation(config: ResolvedConfig, command?: string, tty = false): SshInvocation {
  const sshArgs = buildSshArgs(config, command, tty);
  if (!config.remote.password) {
    return { command: "ssh", args: sshArgs };
  }

  return {
    command: "sshpass",
    args: ["-e", "ssh", ...sshArgs],
    env: {
      SSHPASS: config.remote.password
    }
  };
}

export class SshRemoteClient implements RemoteClient {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly executor: ShellExecutor,
    private readonly dryRun = false
  ) {}

  async run(command: string, options: { input?: string; tty?: boolean } = {}): Promise<CommandResult> {
    const invocation = buildSshInvocation(this.config, command, options.tty);
    return requireSuccess(
      this.executor.run(invocation.command, invocation.args, {
        env: invocation.env,
        input: options.input,
        dryRun: this.dryRun,
        stdio: options.tty ? "inherit" : "pipe"
      }),
      `Remote command failed: ${command}`
    );
  }

  async writeText(remotePath: string, content: string, mode = "600"): Promise<void> {
    const directory = dirnameRemote(remotePath);
    const command = [
      `mkdir -p ${quoteRemotePath(directory)}`,
      `cat > ${quoteRemotePath(remotePath)}`,
      `chmod ${shellQuote(mode)} ${quoteRemotePath(remotePath)}`
    ].join(" && ");
    await this.run(command, { input: content });
  }

  async readText(remotePath: string): Promise<string> {
    const result = await this.run(`cat ${quoteRemotePath(remotePath)}`);
    return result.stdout;
  }

  async interactive(command: string): Promise<CommandResult> {
    return this.run(command, { tty: true });
  }
}
