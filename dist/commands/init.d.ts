import { type DevcontainerTelemetryAutostartResult } from "../devcontainer-autostart.js";
export interface InitResult {
    path: string;
    created: boolean;
    telemetryAutostart?: DevcontainerTelemetryAutostartResult;
}
export declare function initProject(projectRoot: string, options?: {
    force?: boolean;
    telemetryAutostart?: boolean;
}): Promise<InitResult>;
