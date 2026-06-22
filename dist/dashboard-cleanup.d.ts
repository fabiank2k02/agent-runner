import type { CommandContext } from "./context.js";
export interface DashboardTestCleanupResult {
    ok: boolean;
    prefix: string;
    deleted: Record<string, number | null>;
    r2ObjectsDeleted: number;
    r2KeysDeleted: string[];
    r2Errors: Array<{
        key: string;
        error: string;
    }>;
    remaining: Record<string, number>;
}
export declare function cleanupDashboardLiveTestData(context: CommandContext, prefix: string): Promise<DashboardTestCleanupResult>;
