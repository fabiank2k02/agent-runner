import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export interface ManifestEntry {
  path: string;
  type: "file" | "directory" | "symlink";
  mode: number;
  size?: number;
  hash?: string;
  target?: string;
}

export interface ProjectManifest {
  version: 1;
  root: string;
  createdAt: string;
  digest: string;
  entries: ManifestEntry[];
}

const excludedRelativePrefixes = [".agent-runner/tmp", ".agent-runner/cache"];

export async function createProjectManifest(projectRoot: string): Promise<ProjectManifest> {
  const root = path.resolve(projectRoot);
  const entries: ManifestEntry[] = [];
  await walk(root, root, entries);
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const digestHash = createHash("sha256");
  for (const entry of entries) {
    digestHash.update(JSON.stringify(entry));
    digestHash.update("\n");
  }

  return {
    version: 1,
    root,
    createdAt: new Date().toISOString(),
    digest: digestHash.digest("hex"),
    entries
  };
}

async function walk(root: string, current: string, entries: ManifestEntry[]): Promise<void> {
  const dirents = await fs.promises.readdir(current, { withFileTypes: true });
  for (const dirent of dirents) {
    const absolute = path.join(current, dirent.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (isExcluded(relative)) {
      continue;
    }

    const stat = await fs.promises.lstat(absolute);
    if (dirent.isSymbolicLink()) {
      entries.push({
        path: relative,
        type: "symlink",
        mode: stat.mode,
        target: await fs.promises.readlink(absolute)
      });
      continue;
    }

    if (dirent.isDirectory()) {
      entries.push({
        path: relative,
        type: "directory",
        mode: stat.mode
      });
      await walk(root, absolute, entries);
      continue;
    }

    if (dirent.isFile()) {
      entries.push({
        path: relative,
        type: "file",
        mode: stat.mode,
        size: stat.size,
        hash: await hashFile(absolute)
      });
    }
  }
}

function isExcluded(relative: string): boolean {
  return excludedRelativePrefixes.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}
