export interface InitResult {
    path: string;
    created: boolean;
}
export declare function initProject(projectRoot: string, options?: {
    force?: boolean;
}): Promise<InitResult>;
