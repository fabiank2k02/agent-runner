import type { CommandContext } from "../context.js";
import type { TaskState } from "../state.js";
export interface DashboardObserverResult {
    enabled: boolean;
    sessionName?: string;
    summaryFile?: string;
    logFile?: string;
    error?: string;
}
export declare function startDashboardObserver(context: CommandContext, task: TaskState): Promise<DashboardObserverResult>;
