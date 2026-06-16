import os from "node:os";
import path from "node:path";
import { joinRemotePath } from "./quote.js";
export function expandHome(input) {
    if (input === "~") {
        return os.homedir();
    }
    if (input.startsWith("~/")) {
        return path.join(os.homedir(), input.slice(2));
    }
    return input;
}
export function projectSlugFromPath(projectRoot) {
    const base = path.basename(path.resolve(projectRoot));
    const slug = base
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .slice(0, 80);
    return slug || "project";
}
export function resolveLayout(config) {
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
export function ensureTrailingSlash(input) {
    return input.endsWith(path.sep) ? input : `${input}${path.sep}`;
}
//# sourceMappingURL=paths.js.map