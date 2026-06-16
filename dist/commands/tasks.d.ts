import type { CommandContext } from "../context.js";
import { type TaskState } from "../state.js";
import { type DashboardObserverResult } from "./dashboard.js";
export interface RunTaskResult extends TaskState {
    statusFile: string;
    logFile: string;
    dashboardObserver?: DashboardObserverResult;
}
export declare function createTaskId(date?: Date): string;
export declare function sessionName(projectSlug: string, taskId: string): string;
export declare function runTask(context: CommandContext, prompt: string, options?: {
    taskId?: string;
}): Promise<RunTaskResult>;
export declare function taskStatus(context: CommandContext, taskId?: string): Promise<string>;
export declare function taskLogs(context: CommandContext, taskId?: string, lines?: number): Promise<string>;
export declare function attachTask(context: CommandContext, taskId?: string): Promise<void>;
export declare function stopTask(context: CommandContext, taskId?: string): Promise<void>;
