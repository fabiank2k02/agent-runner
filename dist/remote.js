import { dirnameRemote, quoteRemotePath, shellQuote } from "./quote.js";
import { requireSuccess } from "./shell.js";
export function remoteTarget(config) {
    if (!config.remote.host || !config.remote.user) {
        throw new Error("Remote host and user are required. Set AGENT_RUNNER_REMOTE_HOST and AGENT_RUNNER_REMOTE_USER.");
    }
    return `${config.remote.user}@${config.remote.host}`;
}
export function buildSshArgs(config, command, tty = false) {
    const args = [];
    if (tty) {
        args.push("-t");
    }
    args.push("-p", String(config.remote.port));
    args.push("-o", "StrictHostKeyChecking=accept-new");
    args.push("-o", "ConnectTimeout=10");
    args.push("-o", "ConnectionAttempts=1");
    if (config.remote.password) {
        args.push("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no");
    }
    else if (config.remote.sshKey) {
        args.push("-i", config.remote.sshKey);
    }
    args.push(remoteTarget(config));
    if (command) {
        args.push(command);
    }
    return args;
}
export function buildSshInvocation(config, command, tty = false) {
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
export class SshRemoteClient {
    config;
    executor;
    dryRun;
    constructor(config, executor, dryRun = false) {
        this.config = config;
        this.executor = executor;
        this.dryRun = dryRun;
    }
    async run(command, options = {}) {
        const invocation = buildSshInvocation(this.config, command, options.tty);
        return requireSuccess(this.executor.run(invocation.command, invocation.args, {
            env: invocation.env,
            input: options.input,
            dryRun: this.dryRun,
            stdio: options.tty ? "inherit" : "pipe"
        }), `Remote command failed: ${command}`);
    }
    async writeText(remotePath, content, mode = "600") {
        const directory = dirnameRemote(remotePath);
        const command = [
            `mkdir -p ${quoteRemotePath(directory)}`,
            `cat > ${quoteRemotePath(remotePath)}`,
            `chmod ${shellQuote(mode)} ${quoteRemotePath(remotePath)}`
        ].join(" && ");
        await this.run(command, { input: content });
    }
    async readText(remotePath) {
        const result = await this.run(`cat ${quoteRemotePath(remotePath)}`);
        return result.stdout;
    }
    async interactive(command) {
        return this.run(command, { tty: true });
    }
}
//# sourceMappingURL=remote.js.map