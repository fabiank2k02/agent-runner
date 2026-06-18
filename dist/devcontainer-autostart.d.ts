export declare const telemetryAutostartKey = "agent-runner-telemetry";
export declare const preservedPostStartKey = "project-post-start";
export interface DevcontainerTelemetryAutostartResult {
    path: string;
    exists: boolean;
    installed: boolean;
    changed: boolean;
    command?: string;
    reason?: string;
}
type DevcontainerPostStartCommand = string | string[] | Record<string, unknown>;
interface DevcontainerConfig {
    postStartCommand?: DevcontainerPostStartCommand;
    [key: string]: unknown;
}
export declare function telemetryAutostartCommand(): string;
export declare function installDevcontainerTelemetryAutostart(projectRoot: string): Promise<DevcontainerTelemetryAutostartResult>;
export declare function devcontainerTelemetryAutostartStatus(projectRoot: string): Promise<DevcontainerTelemetryAutostartResult>;
export declare function withTelemetryAutostart(config: DevcontainerConfig, command?: string): DevcontainerConfig;
export {};
