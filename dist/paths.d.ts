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
export declare function expandHome(input: string): string;
export declare function projectSlugFromPath(projectRoot: string): string;
export declare function resolveLayout(config: ResolvedConfig): RunnerLayout;
export declare function ensureTrailingSlash(input: string): string;
