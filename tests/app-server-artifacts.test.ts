import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AppServerArtifactPersistor,
  artifactStatusMetadata,
  readPngDimensions
} from "../src/app-server-artifacts.js";
import { tempDir } from "./helpers.js";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("app-server image artifacts", () => {
  it("extracts and saves a PNG from an app-server data URL result", async () => {
    const workspaceDir = await tempDir("artifact-data-url");
    const persistor = new AppServerArtifactPersistor({ workspaceDir, taskId: "task-data" });

    await persistor.inspectMessage({
      method: "rawResponseItem/completed",
      params: {
        item: {
          type: "image_generation_call",
          id: "img-data",
          status: "completed",
          result: `data:image/png;base64,${pngBase64}`
        }
      }
    });
    const manifest = await persistor.writeManifest();

    expect(manifest.images).toHaveLength(1);
    expect(manifest.images[0].mimeType).toBe("image/png");
    expect(manifest.images[0].width).toBe(1);
    expect(manifest.images[0].height).toBe(1);
    expect(manifest.images[0].eventMethod).toBe("rawResponseItem/completed");
    expect(fs.existsSync(path.join(workspaceDir, manifest.images[0].file))).toBe(true);
  });

  it("copies a PNG from a local app-server file reference", async () => {
    const workspaceDir = await tempDir("artifact-file");
    const sourceFile = path.join(workspaceDir, "source.png");
    await fs.promises.writeFile(sourceFile, Buffer.from(pngBase64, "base64"));
    const persistor = new AppServerArtifactPersistor({ workspaceDir, taskId: "task-file" });

    await persistor.inspectMessage({
      method: "item/completed",
      params: {
        item: {
          type: "imageView",
          id: "view-file",
          path: sourceFile
        }
      }
    });
    const manifest = await persistor.writeManifest();

    expect(manifest.images).toHaveLength(1);
    expect(manifest.images[0].sourceKind).toBe("local_file");
    expect(manifest.images[0].itemId).toBe("view-file");
    expect(readPngDimensions(await fs.promises.readFile(path.join(workspaceDir, manifest.images[0].file)))).toEqual({
      width: 1,
      height: 1
    });
  });

  it("writes an artifact manifest and exposes task status metadata when images exist", async () => {
    const workspaceDir = await tempDir("artifact-manifest");
    const persistor = new AppServerArtifactPersistor({ workspaceDir, taskId: "task-manifest" });

    await persistor.inspectMessage({
      method: "item/completed",
      params: {
        item: {
          type: "imageGeneration",
          id: "img-manifest",
          status: "completed",
          result: pngBase64
        }
      }
    });
    const manifest = await persistor.writeManifest();
    const onDisk = JSON.parse(await fs.promises.readFile(path.join(workspaceDir, manifest.manifestFile), "utf8"));

    expect(onDisk.images).toHaveLength(1);
    expect(onDisk.artifactDir).toBe(".agent-runner/artifacts/task-manifest");
    expect(artifactStatusMetadata(manifest)).toEqual({
      artifactManifestFile: ".agent-runner/artifacts/task-manifest/manifest.json",
      artifactCount: 1
    });
  });

  it("reports missing image references without counting them as saved artifacts", async () => {
    const workspaceDir = await tempDir("artifact-missing");
    const persistor = new AppServerArtifactPersistor({ workspaceDir, taskId: "task-missing" });

    await persistor.inspectMessage({
      method: "item/completed",
      params: {
        item: {
          type: "imageView",
          id: "missing-image",
          path: "does-not-exist.png"
        }
      }
    });
    const manifest = await persistor.writeManifest();

    expect(manifest.images).toHaveLength(0);
    expect(manifest.blockers).toHaveLength(1);
    expect(manifest.blockers[0].kind).toBe("missing_file");
    expect(artifactStatusMetadata(manifest)).toEqual({});
  });
});
