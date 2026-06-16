import os from "node:os";
import path from "node:path";
import { joinRemotePath } from "./quote.js";
import type { ResolvedConfig } from "./config.js";

export interface RunnerLayout {
  projectSlug: string;
  localStateDir: string;
  localStateFile: string;
  remoteRoot: string;
  remoteProjectDir: string;
  remoteProjectParent: string;
  remoteProjectStateFile: string;
  remoteProjectLogDir: string;
  remoteCodexAuthFile: string;
}

export function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function projectSlugFromPath(projectRoot: string): string {
  const base = path.basename(path.resolve(projectRoot));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return slug || "project";
}

export function resolveLayout(config: ResolvedConfig): RunnerLayout {
  const projectSlug = config.projectSlug;
  const localStateDir = path.join(os.homedir(), ".agent-runner", "state");
  const remoteProjectParent = joinRemotePath(config.remote.root, "projects");
  const remoteProjectDir = joinRemotePath(remoteProjectParent, projectSlug);
  const remoteProjectLogDir = joinRemotePath(config.remote.root, "logs", projectSlug);

  return {
    projectSlug,
    localStateDir,
    localStateFile: path.join(localStateDir, `${projectSlug}.json`),
    remoteRoot: config.remote.root,
    remoteProjectParent,
    remoteProjectDir,
    remoteProjectStateFile: joinRemotePath(config.remote.root, "state", `${projectSlug}.json`),
    remoteProjectLogDir,
    remoteCodexAuthFile: joinRemotePath(config.remote.root, "secrets", "codex", "auth.json")
  };
}

export function ensureTrailingSlash(input: string): string {
  return input.endsWith(path.sep) ? input : `${input}${path.sep}`;
}
