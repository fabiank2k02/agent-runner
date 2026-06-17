import type { CommandContext } from "../context.js";
import type { TaskState } from "../state.js";
export declare class DashboardLaunchError extends Error {
    constructor(message: string);
}
export interface DashboardObserverResult {
    enabled: boolean;
    sessionName?: string;
    summaryFile?: string;
    logFile?: string;
    verified?: boolean;
    error?: string;
}
export declare function assertDashboardLaunchConfig(context: CommandContext): void;
export declare function startDashboardObserver(context: CommandContext, task: TaskState): Promise<DashboardObserverResult>;
export declare function dashboardJobsUrl(endpoint: string): string;
