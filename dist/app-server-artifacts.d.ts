export type ArtifactSourceKind = "data_url" | "base64" | "local_file" | "http_url";
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
    kind: "missing_file" | "invalid_image" | "download_failed" | "unsupported_reference" | "opaque_id";
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
interface ImageInfo {
    mimeType: string;
    extension: string;
    width?: number;
    height?: number;
}
export declare class AppServerArtifactPersistor {
    readonly workspaceDir: string;
    readonly taskId: string;
    readonly artifactDirRelative: string;
    readonly imageDirRelative: string;
    readonly manifestFileRelative: string;
    readonly artifactDir: string;
    readonly imageDir: string;
    readonly manifestFile: string;
    private readonly fetchImpl?;
    private readonly now;
    private readonly logRecord?;
    private readonly images;
    private readonly blockers;
    private readonly seenImageHashes;
    private readonly seenBlockers;
    private createdAt?;
    constructor(options: AppServerArtifactPersistorOptions);
    get imageCount(): number;
    get blockerCount(): number;
    currentManifest(): ArtifactManifest;
    inspectMessage(message: unknown): Promise<void>;
    writeManifest(): Promise<ArtifactManifest>;
    private scanValue;
    private scanKnownImageItem;
    private scanFileReference;
    private scanOpaqueReference;
    private scanString;
    private persistImageString;
    private persistLocalFile;
    private persistHttpUrl;
    private persistBuffer;
    private addBlocker;
}
export declare function detectImage(bytes: Buffer, mimeType?: string): ImageInfo | undefined;
export declare function readPngDimensions(bytes: Buffer): {
    width: number;
    height: number;
} | undefined;
export declare function artifactStatusMetadata(manifest: ArtifactManifest): {
    artifactManifestFile?: string;
    artifactCount?: number;
};
export {};
