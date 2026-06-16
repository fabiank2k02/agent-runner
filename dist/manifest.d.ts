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
export declare function createProjectManifest(projectRoot: string): Promise<ProjectManifest>;
