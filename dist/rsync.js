import path from "node:path";
import { ensureTrailingSlash } from "./paths.js";
import { remoteTarget } from "./remote.js";
import { requireSuccess } from "./shell.js";
const runnerExcludes = [".agent-runner/tmp/", ".agent-runner/cache/"];
export function buildRsyncArgs(config, options) {
    const sshParts = [
        "ssh",
        "-p",
        String(config.remote.port),
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ConnectionAttempts=1"
    ];
    if (config.remote.password) {
        sshParts.push("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no");
    }
    else if (config.remote.sshKey) {
        sshParts.push("-i", config.remote.sshKey);
    }
    const args = [
        "-az",
        "--delete",
        "--delete-excluded",
        "--human-readable",
        "-e",
        sshParts.join(" ")
    ];
    if (options.dryRun) {
        args.push("--dry-run");
    }
    for (const exclude of [...runnerExcludes, ...(options.extraExcludes ?? [])]) {
        args.push("--exclude", exclude);
    }
    const local = ensureTrailingSlash(path.resolve(options.localProjectRoot));
    const remote = `${remoteTarget(config)}:${ensureRemoteTrailingSlash(options.remoteProjectDir)}`;
    if (options.direction === "push") {
        args.push(local, remote);
    }
    else {
        args.push(remote, local);
    }
    return args;
}
export async function runRsync(config, executor, options) {
    const command = config.remote.password ? "sshpass" : "rsync";
    const args = config.remote.password
        ? ["-e", "rsync", ...buildRsyncArgs(config, options)]
        : buildRsyncArgs(config, options);
    return requireSuccess(executor.run(command, args, {
        dryRun: options.dryRun,
        env: config.remote.password ? { SSHPASS: config.remote.password } : undefined
    }), `${options.direction === "push" ? "Push" : "Pull"} rsync failed`);
}
function ensureRemoteTrailingSlash(remotePath) {
    return remotePath.endsWith("/") ? remotePath : `${remotePath}/`;
}
//# sourceMappingURL=rsync.js.map