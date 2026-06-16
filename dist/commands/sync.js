import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProjectManifest } from "../manifest.js";
import { dirnameRemote, quoteRemotePath } from "../quote.js";
import { remoteTarget } from "../remote.js";
import { runRsync } from "../rsync.js";
import { requireSuccess } from "../shell.js";
import { readLocalState, stateFromPull, stateFromPush, writeLocalState } from "../state.js";
import { refreshManagedDroplet } from "./droplet.js";
export async function pushProject(context) {
    const { config, layout, remote, executor, dryRun } = context;
    const manifest = await createProjectManifest(config.projectRoot);
    const existing = await readLocalState(layout);
    await remote.run(`mkdir -p ${quoteRemotePath(layout.remoteProjectParent)} ${quoteRemotePath(layout.remoteProjectLogDir)} ${quoteRemotePath(dirnameRemote(layout.remoteProjectStateFile))} ${quoteRemotePath(dirnameRemote(layout.remoteCodexAuthFile))}`);
    if (!fs.existsSync(config.codexAuthSource)) {
        throw new Error(`Codex auth cache not found: ${config.codexAuthSource}`);
    }
    const authJson = await fs.promises.readFile(config.codexAuthSource, "utf8");
    await remote.writeText(layout.remoteCodexAuthFile, authJson, "600");
    await runRsync(config, executor, {
        direction: "push",
        localProjectRoot: config.projectRoot,
        remoteProjectDir: layout.remoteProjectDir,
        dryRun,
        extraExcludes: config.rsync.excludes
    });
    const nextState = stateFromPush(layout, manifest, existing);
    await writeLocalState(layout, nextState);
    await remote.writeText(layout.remoteProjectStateFile, JSON.stringify(nextState, null, 2), "600");
    return manifest.digest;
}
export async function pullProject(context) {
    const { config, layout, executor, dryRun } = context;
    const existing = await readLocalState(layout);
    if (!existing?.lastPushedManifest) {
        throw new Error("No previous push state found. Run agent-runner push before pulling from the VPS.");
    }
    await validatePullTarget(context);
    const current = await createProjectManifest(config.projectRoot);
    let stash;
    if (current.digest !== existing.lastPushedManifest.digest) {
        stash = await stashLocalChanges(context, current.digest);
    }
    await runRsync(config, executor, {
        direction: "pull",
        localProjectRoot: config.projectRoot,
        remoteProjectDir: layout.remoteProjectDir,
        dryRun,
        extraExcludes: config.rsync.excludes
    });
    if (stash) {
        await restoreLocalStash(context, stash);
    }
    const updated = await createProjectManifest(config.projectRoot);
    await writeLocalState(layout, stateFromPull(layout, updated, existing));
    return updated.digest;
}
async function validatePullTarget(context) {
    const { config, layout, remote } = context;
    if (config.digitalOcean.token) {
        const refresh = await refreshManagedDroplet(config);
        if (refresh.staleCleared) {
            throw new Error([
                `Saved managed droplet ${refresh.staleDroplet?.id} no longer exists; local managed state was cleared.`,
                "No pull was attempted and the local worktree was not changed.",
                "Run agent-runner start to create a new droplet before pulling."
            ].join("\n"));
        }
    }
    try {
        remoteTarget(config);
    }
    catch (error) {
        throw new Error([
            error instanceof Error ? error.message : String(error),
            "No pull was attempted and the local worktree was not changed.",
            "Run agent-runner start before agent-runner finish, or configure a remote host/user."
        ].join("\n"));
    }
    await remote.run(`[ -d ${quoteRemotePath(layout.remoteProjectDir)} ] || { echo "Remote project directory not found: ${layout.remoteProjectDir}" >&2; exit 44; }`);
}
async function stashLocalChanges(context, digest) {
    const { config, executor, dryRun } = context;
    const status = await requireSuccess(executor.run("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: config.projectRoot,
        dryRun
    }), "Unable to check local git status before pulling from the VPS");
    if (!status.stdout.trim()) {
        return undefined;
    }
    const timestamp = new Date().toISOString();
    const message = `agent-runner pre-pull ${timestamp} ${digest}`;
    await requireSuccess(executor.run("git", ["stash", "push", "--include-untracked", "-m", message], {
        cwd: config.projectRoot,
        dryRun
    }), "Unable to stash local changes before pulling from the VPS");
    if (dryRun) {
        return undefined;
    }
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-runner-stash-"));
    const bundlePath = path.join(tempDir, "stash.bundle");
    await requireSuccess(executor.run("git", ["bundle", "create", bundlePath, "refs/stash"], {
        cwd: config.projectRoot
    }), "Unable to preserve local stash before pulling from the VPS");
    return { message, bundlePath };
}
async function restoreLocalStash(context, stash) {
    const { config, executor } = context;
    try {
        await requireSuccess(executor.run("git", ["fetch", stash.bundlePath, "refs/stash"], {
            cwd: config.projectRoot
        }), "Unable to import preserved local stash after pulling from the VPS");
        await requireSuccess(executor.run("git", ["stash", "store", "-m", stash.message, "FETCH_HEAD"], {
            cwd: config.projectRoot
        }), "Unable to restore local stash after pulling from the VPS");
    }
    finally {
        await fs.promises.rm(path.dirname(stash.bundlePath), { recursive: true, force: true });
    }
}
//# sourceMappingURL=sync.js.map