import type { ResolvedConfig } from "./config.js";
export interface DashboardJsonResponse<T = Record<string, unknown>> {
    response: Response;
    body: T;
}
export declare function dashboardAuthHeaders(dashboard: ResolvedConfig["dashboard"], options?: {
    contentType?: boolean;
}): Record<string, string>;
export declare function dashboardApiUrl(endpoint: string, pathname: string): string;
export declare function readDashboardJson<T = Record<string, unknown>>(response: Response, label: string): Promise<DashboardJsonResponse<T>>;
