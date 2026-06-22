import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ArtifactSourceKind =
  | "data_url"
  | "base64"
  | "local_file"
  | "http_url";

export interface PersistedImageArtifact {
  id: string;
  sourceKind: ArtifactSourceKind;
  sourcePath: string;
  file: string;
  absoluteFile: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  width?: number;
  height?: number;
  eventMethod?: string;
  itemId?: string;
}

export interface ArtifactBlocker {
  kind:
    | "missing_file"
    | "invalid_image"
    | "download_failed"
    | "unsupported_reference"
    | "opaque_id";
  message: string;
  sourcePath: string;
  eventMethod?: string;
  itemId?: string;
  detail?: string;
}

export interface ArtifactManifest {
  version: 1;
  taskId: string;
  artifactDir: string;
  imageDir: string;
  manifestFile: string;
  createdAt: string;
  updatedAt: string;
  images: PersistedImageArtifact[];
  blockers: ArtifactBlocker[];
}

export interface AppServerArtifactPersistorOptions {
  workspaceDir: string;
  taskId: string;
  artifactDirRelative?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (record: Record<string, unknown>) => void;
}

interface ScanContext {
  eventMethod?: string;
  itemId?: string;
  sourceHint?: string;
}

interface ImageInfo {
  mimeType: string;
  extension: string;
  width?: number;
  height?: number;
}

const dataUrlPattern = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/iu;
const imageExtensionPattern = /\.(?:png|webp|jpe?g)(?:[?#].*)?$/iu;

export class AppServerArtifactPersistor {
  readonly workspaceDir: string;
  readonly taskId: string;
  readonly artifactDirRelative: string;
  readonly imageDirRelative: string;
  readonly manifestFileRelative: string;
  readonly artifactDir: string;
  readonly imageDir: string;
  readonly manifestFile: string;

  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => Date;
  private readonly logRecord?: (record: Record<string, unknown>) => void;
  private readonly images: PersistedImageArtifact[] = [];
  private readonly blockers: ArtifactBlocker[] = [];
  private readonly seenImageHashes = new Set<string>();
  private readonly seenBlockers = new Set<string>();
  private createdAt?: string;

  constructor(options: AppServerArtifactPersistorOptions) {
    this.workspaceDir = path.resolve(options.workspaceDir);
    this.taskId = options.taskId;
    this.artifactDirRelative =
      options.artifactDirRelative ?? path.posix.join(".agent-runner", "artifacts", options.taskId);
    this.imageDirRelative = path.posix.join(this.artifactDirRelative, "images");
    this.manifestFileRelative = path.posix.join(this.artifactDirRelative, "manifest.json");
    this.artifactDir = path.resolve(this.workspaceDir, this.artifactDirRelative);
    this.imageDir = path.resolve(this.workspaceDir, this.imageDirRelative);
    this.manifestFile = path.resolve(this.workspaceDir, this.manifestFileRelative);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.logRecord = options.log;
  }

  get imageCount(): number {
    return this.images.length;
  }

  get blockerCount(): number {
    return this.blockers.length;
  }

  currentManifest(): ArtifactManifest {
    const now = this.now().toISOString();
    return {
      version: 1,
      taskId: this.taskId,
      artifactDir: this.artifactDirRelative,
      imageDir: this.imageDirRelative,
      manifestFile: this.manifestFileRelative,
      createdAt: this.createdAt ?? now,
      updatedAt: now,
      images: [...this.images],
      blockers: [...this.blockers]
    };
  }

  async inspectMessage(message: unknown): Promise<void> {
    await this.scanValue(message, "$", undefined, {
      eventMethod: eventMethod(message),
      itemId: itemId(message)
    });
  }

  async writeManifest(): Promise<ArtifactManifest> {
    const manifest = this.currentManifest();
    await fs.promises.mkdir(this.artifactDir, { recursive: true });
    await fs.promises.writeFile(this.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    this.logRecord?.({
      type: "artifact.manifest",
      timestamp: this.now().toISOString(),
      artifactManifestFile: this.manifestFileRelative,
      artifactCount: manifest.images.length,
      blockerCount: manifest.blockers.length
    });
    return manifest;
  }

  private async scanValue(
    value: unknown,
    sourcePath: string,
    key: string | undefined,
    context: ScanContext
  ): Promise<void> {
    if (typeof value === "string") {
      await this.scanString(value, sourcePath, key, context);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      for (const [index, entry] of value.entries()) {
        await this.scanValue(entry, `${sourcePath}[${index}]`, undefined, context);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    await this.scanKnownImageItem(record, sourcePath, context);
    await this.scanFileReference(record, sourcePath, context);
    this.scanOpaqueReference(record, sourcePath, context);

    for (const [childKey, childValue] of Object.entries(record)) {
      await this.scanValue(childValue, `${sourcePath}.${childKey}`, childKey, {
        ...context,
        itemId: typeof record.id === "string" ? record.id : context.itemId
      });
    }
  }

  private async scanKnownImageItem(
    record: Record<string, unknown>,
    sourcePath: string,
    context: ScanContext
  ): Promise<void> {
    if (record.type === "imageGeneration" && typeof record.result === "string" && record.result.trim() !== "") {
      await this.persistImageString(record.result, `${sourcePath}.result`, {
        ...context,
        itemId: typeof record.id === "string" ? record.id : context.itemId,
        sourceHint: "imageGeneration.result"
      });
      if (typeof record.savedPath === "string") {
        await this.persistLocalFile(record.savedPath, `${sourcePath}.savedPath`, {
          ...context,
          itemId: typeof record.id === "string" ? record.id : context.itemId,
          sourceHint: "imageGeneration.savedPath"
        }, true);
      }
    }

    if (record.type === "image_generation_call" && typeof record.result === "string" && record.result.trim() !== "") {
      await this.persistImageString(record.result, `${sourcePath}.result`, {
        ...context,
        itemId: typeof record.id === "string" ? record.id : context.itemId,
        sourceHint: "image_generation_call.result"
      });
    }

    if (record.type === "imageView" && typeof record.path === "string") {
      await this.persistLocalFile(record.path, `${sourcePath}.path`, {
        ...context,
        itemId: typeof record.id === "string" ? record.id : context.itemId,
        sourceHint: "imageView.path"
      }, true);
    }
  }

  private async scanFileReference(
    record: Record<string, unknown>,
    sourcePath: string,
    context: ScanContext
  ): Promise<void> {
    const pathKeys = ["path", "filePath", "filepath", "localPath", "savedPath"];
    const hasImageMime = typeof record.mimeType === "string" && record.mimeType.startsWith("image/");
    const hasImageType = typeof record.type === "string" && /image|file/iu.test(record.type);

    for (const pathKey of pathKeys) {
      const rawPath = record[pathKey];
      if (typeof rawPath === "string" && (hasImageMime || hasImageType || imageExtensionPattern.test(rawPath))) {
        await this.persistLocalFile(rawPath, `${sourcePath}.${pathKey}`, context, true);
      }
    }

    const url = record.url ?? record.image_url ?? record.imageUrl;
    if (typeof url === "string" && (hasImageMime || hasImageType || dataUrlPattern.test(url) || imageExtensionPattern.test(url))) {
      await this.scanString(url, `${sourcePath}.url`, "url", context);
    }

    const data = record.data ?? record.base64 ?? record.b64_json;
    if (typeof data === "string" && hasImageMime) {
      await this.persistImageString(data, `${sourcePath}.data`, {
        ...context,
        sourceHint: "image base64 field"
      });
    }
  }

  private scanOpaqueReference(
    record: Record<string, unknown>,
    sourcePath: string,
    context: ScanContext
  ): void {
    const idKeys = ["artifactId", "artifact_id", "attachmentId", "attachment_id", "imageId", "image_id"];
    const hasResolvableValue = ["result", "savedPath", "path", "filePath", "url", "image_url", "data", "base64", "b64_json"]
      .some((key) => record[key] !== undefined);
    if (hasResolvableValue) {
      return;
    }

    for (const idKey of idKeys) {
      const value = record[idKey];
      if (typeof value === "string" && value.length > 0) {
        this.addBlocker({
          kind: "opaque_id",
          message: "App-server exposed an opaque image/artifact id without bytes, URL, or local file path.",
          sourcePath: `${sourcePath}.${idKey}`,
          eventMethod: context.eventMethod,
          itemId: context.itemId,
          detail: redactId(value)
        });
      }
    }
  }

  private async scanString(
    value: string,
    sourcePath: string,
    key: string | undefined,
    context: ScanContext
  ): Promise<void> {
    if (dataUrlPattern.test(value)) {
      await this.persistImageString(value, sourcePath, context);
      return;
    }

    if (/^https?:\/\//iu.test(value) && imageExtensionPattern.test(value)) {
      await this.persistHttpUrl(value, sourcePath, context);
      return;
    }

    if (isPathLikeKey(key) && imageExtensionPattern.test(value)) {
      await this.persistLocalFile(value, sourcePath, context, true);
      return;
    }

    if ((path.isAbsolute(value) || value.startsWith("file://")) && imageExtensionPattern.test(value)) {
      await this.persistLocalFile(value, sourcePath, context, false);
    }
  }

  private async persistImageString(value: string, sourcePath: string, context: ScanContext): Promise<void> {
    const dataUrl = dataUrlPattern.exec(value);
    if (dataUrl) {
      await this.persistBuffer(Buffer.from(dataUrl[2].replace(/\s/gu, ""), "base64"), {
        sourceKind: "data_url",
        sourcePath,
        mimeType: dataUrl[1].toLowerCase(),
        context
      });
      return;
    }

    if (looksLikeBase64(value)) {
      await this.persistBuffer(Buffer.from(value.replace(/\s/gu, ""), "base64"), {
        sourceKind: "base64",
        sourcePath,
        context
      });
      return;
    }

    this.addBlocker({
      kind: "invalid_image",
      message: "Image result was not a data URL or decodable base64 image.",
      sourcePath,
      eventMethod: context.eventMethod,
      itemId: context.itemId,
      detail: context.sourceHint
    });
  }

  private async persistLocalFile(
    rawPath: string,
    sourcePath: string,
    context: ScanContext,
    required: boolean
  ): Promise<void> {
    const filePath = resolveCandidatePath(this.workspaceDir, rawPath);
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(filePath);
    } catch (error) {
      if (required) {
        this.addBlocker({
          kind: "missing_file",
          message: "App-server referenced an image file path that does not exist or cannot be read.",
          sourcePath,
          eventMethod: context.eventMethod,
          itemId: context.itemId,
          detail: error instanceof Error ? `${filePath}: ${error.message}` : filePath
        });
      }
      return;
    }

    await this.persistBuffer(bytes, {
      sourceKind: "local_file",
      sourcePath,
      originalFilePath: filePath,
      context
    });
  }

  private async persistHttpUrl(url: string, sourcePath: string, context: ScanContext): Promise<void> {
    if (!this.fetchImpl) {
      this.addBlocker({
        kind: "download_failed",
        message: "No fetch implementation is available to download an app-server image URL.",
        sourcePath,
        eventMethod: context.eventMethod,
        itemId: context.itemId,
        detail: url
      });
      return;
    }

    try {
      const response = await this.fetchImpl(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") ?? undefined;
      await this.persistBuffer(Buffer.from(await response.arrayBuffer()), {
        sourceKind: "http_url",
        sourcePath,
        mimeType: contentType,
        context
      });
    } catch (error) {
      this.addBlocker({
        kind: "download_failed",
        message: "Failed to download app-server image URL.",
        sourcePath,
        eventMethod: context.eventMethod,
        itemId: context.itemId,
        detail: error instanceof Error ? `${url}: ${error.message}` : url
      });
    }
  }

  private async persistBuffer(
    bytes: Buffer,
    options: {
      sourceKind: ArtifactSourceKind;
      sourcePath: string;
      mimeType?: string;
      originalFilePath?: string;
      context: ScanContext;
    }
  ): Promise<void> {
    const info = detectImage(bytes, options.mimeType);
    if (!info) {
      this.addBlocker({
        kind: "invalid_image",
        message: "App-server image payload was not a supported PNG, JPEG, or WebP file.",
        sourcePath: options.sourcePath,
        eventMethod: options.context.eventMethod,
        itemId: options.context.itemId,
        detail: options.context.sourceHint
      });
      return;
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (this.seenImageHashes.has(sha256)) {
      return;
    }
    this.seenImageHashes.add(sha256);

    const index = this.images.length + 1;
    const fileName = `${String(index).padStart(2, "0")}-${slugFromSource(options.context.sourceHint ?? options.sourceKind)}-${sha256.slice(0, 12)}.${info.extension}`;
    const absoluteFile = path.join(this.imageDir, fileName);
    const relativeFile = path.posix.join(this.imageDirRelative, fileName);

    await fs.promises.mkdir(this.imageDir, { recursive: true });
    await fs.promises.writeFile(absoluteFile, bytes);

    const image: PersistedImageArtifact = {
      id: sha256.slice(0, 16),
      sourceKind: options.sourceKind,
      sourcePath: options.sourcePath,
      file: relativeFile,
      absoluteFile,
      mimeType: info.mimeType,
      byteLength: bytes.byteLength,
      sha256,
      width: info.width,
      height: info.height,
      eventMethod: options.context.eventMethod,
      itemId: options.context.itemId
    };
    this.images.push(image);
    this.createdAt ??= this.now().toISOString();

    this.logRecord?.({
      type: "artifact.saved",
      timestamp: this.now().toISOString(),
      artifactManifestFile: this.manifestFileRelative,
      artifact: image,
      originalFilePath: options.originalFilePath
    });

    await this.writeManifest();
  }

  private addBlocker(blocker: ArtifactBlocker): void {
    const key = JSON.stringify(blocker);
    if (this.seenBlockers.has(key)) {
      return;
    }
    this.seenBlockers.add(key);
    this.blockers.push(blocker);
    this.createdAt ??= this.now().toISOString();
    this.logRecord?.({
      type: "artifact.blocker",
      timestamp: this.now().toISOString(),
      artifactManifestFile: this.manifestFileRelative,
      blocker
    });
  }
}

export function detectImage(bytes: Buffer, mimeType?: string): ImageInfo | undefined {
  const normalizedMime = mimeType?.split(";")[0]?.trim().toLowerCase();
  const png = readPngDimensions(bytes);
  if (png) {
    return { mimeType: "image/png", extension: "png", ...png };
  }

  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  if (normalizedMime?.startsWith("image/")) {
    return undefined;
  }
  return undefined;
}

export function readPngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24) {
    return undefined;
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature)) {
    return undefined;
  }
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    return undefined;
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

export function artifactStatusMetadata(manifest: ArtifactManifest): { artifactManifestFile?: string; artifactCount?: number } {
  if (manifest.images.length === 0) {
    return {};
  }
  return {
    artifactManifestFile: manifest.manifestFile,
    artifactCount: manifest.images.length
  };
}

function eventMethod(value: unknown): string | undefined {
  if (value && typeof value === "object" && "method" in value) {
    const method = (value as { method?: unknown }).method;
    return typeof method === "string" ? method : undefined;
  }
  return undefined;
}

function itemId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const params = (value as { params?: unknown }).params;
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const item = (params as { item?: unknown }).item;
  if (item && typeof item === "object") {
    const id = (item as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function isPathLikeKey(key: string | undefined): boolean {
  return key !== undefined && /^(?:path|filePath|filepath|localPath|savedPath)$/iu.test(key);
}

function resolveCandidatePath(workspaceDir: string, rawPath: string): string {
  if (rawPath.startsWith("file://")) {
    return new URL(rawPath).pathname;
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(workspaceDir, rawPath);
}

function looksLikeBase64(value: string): boolean {
  const cleaned = value.replace(/\s/gu, "");
  return cleaned.length >= 32 && cleaned.length % 4 === 0 && /^[a-z0-9+/]+={0,2}$/iu.test(cleaned);
}

function slugFromSource(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return slug || "image";
}

function redactId(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
