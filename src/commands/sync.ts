import fs from "node:fs";
import type { CommandContext } from "../context.js";
import { createProjectManifest } from "../manifest.js";
import { dirnameRemote, quoteRemotePath } from "../quote.js";
import { runRsync } from "../rsync.js";
import {
  readLocalState,
  stateFromPull,
  stateFromPush,
  writeLocalState
} from "../state.js";

export async function pushProject(context: CommandContext): Promise<string> {
  const { config, layout, remote, executor, dryRun } = context;
  const manifest = await createProjectManifest(config.projectRoot);
  const existing = await readLocalState(layout);

  await remote.run(
    `mkdir -p ${quoteRemotePath(layout.remoteProjectParent)} ${quoteRemotePath(layout.remoteProjectLogDir)} ${quoteRemotePath(dirnameRemote(layout.remoteProjectStateFile))} ${quoteRemotePath(dirnameRemote(layout.remoteCodexAuthFile))}`
  );

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

export async function pullProject(context: CommandContext): Promise<string> {
  const { config, layout, executor, dryRun } = context;
  const existing = await readLocalState(layout);
  if (!existing?.lastPushedManifest) {
    throw new Error("No previous push state found. Run agent-runner push before pulling from the VPS.");
  }

  const current = await createProjectManifest(config.projectRoot);
  if (current.digest !== existing.lastPushedManifest.digest) {
    throw new Error(
      [
        "Refusing to pull because the local workspace changed after the last push.",
        `Expected manifest ${existing.lastPushedManifest.digest}, got ${current.digest}.`,
        "Commit, stash, or back up local changes before pulling remote work back."
      ].join("\n")
    );
  }

  await runRsync(config, executor, {
    direction: "pull",
    localProjectRoot: config.projectRoot,
    remoteProjectDir: layout.remoteProjectDir,
    dryRun,
    extraExcludes: config.rsync.excludes
  });

  const updated = await createProjectManifest(config.projectRoot);
  await writeLocalState(layout, stateFromPull(layout, updated, existing));
  return updated.digest;
}
