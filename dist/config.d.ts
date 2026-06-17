import { z } from "zod";
declare const configFileSchema: z.ZodObject<{
    projectSlug: z.ZodOptional<z.ZodString>;
    remote: z.ZodOptional<z.ZodObject<{
        host: z.ZodOptional<z.ZodString>;
        user: z.ZodOptional<z.ZodString>;
        port: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        sshKey: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
        root: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    codexAuthSource: z.ZodOptional<z.ZodString>;
    devcontainer: z.ZodDefault<z.ZodObject<{
        extraArgs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    codex: z.ZodDefault<z.ZodObject<{
        sandbox: z.ZodDefault<z.ZodString>;
        approval: z.ZodDefault<z.ZodString>;
        reasoningEffort: z.ZodDefault<z.ZodString>;
        yolo: z.ZodDefault<z.ZodBoolean>;
        model: z.ZodOptional<z.ZodString>;
        extraArgs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    rsync: z.ZodDefault<z.ZodObject<{
        excludes: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    telemetry: z.ZodDefault<z.ZodObject<{
        denyGlobs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    digitalOcean: z.ZodDefault<z.ZodObject<{
        region: z.ZodOptional<z.ZodString>;
        size: z.ZodOptional<z.ZodString>;
        image: z.ZodOptional<z.ZodString>;
        dropletName: z.ZodOptional<z.ZodString>;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    dashboard: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        endpoint: z.ZodOptional<z.ZodString>;
        tokenEnv: z.ZodDefault<z.ZodString>;
        intervalSeconds: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        model: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodDefault<z.ZodString>;
        maxLogLines: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        costs: z.ZodDefault<z.ZodObject<{
            digitalOceanHourlyUsd: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            codexSubscriptionMonthlyUsd: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            codexSubscriptionSeatMultiplier: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            codexSubscriptionMonthlyTokens: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            codexWeeklyTokenAllowance: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            codexObservedWeeklyTokens: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AgentRunnerConfigFile = z.infer<typeof configFileSchema>;
export interface ResolvedConfig {
    projectRoot: string;
    projectSlug: string;
    remote: {
        host?: string;
        user?: string;
        port: number;
        sshKey?: string;
        password?: string;
        root: string;
    };
    codexAuthSource: string;
    devcontainer: {
        extraArgs: string[];
    };
    codex: {
        sandbox: string;
        approval: string;
        reasoningEffort: string;
        yolo: boolean;
        model?: string;
        extraArgs: string[];
    };
    rsync: {
        excludes: string[];
    };
    telemetry: {
        denyGlobs: string[];
    };
    digitalOcean: {
        token?: string;
        region: string;
        size: string;
        image: string;
        dropletName: string;
        tags: string[];
        hourlyPriceUsd?: number;
    };
    dashboard: {
        enabled: boolean;
        endpoint?: string;
        token?: string;
        tokenEnv: string;
        intervalSeconds: number;
        model?: string;
        reasoningEffort: string;
        maxLogLines: number;
        costs: {
            digitalOceanHourlyUsd?: number;
            codexSubscriptionMonthlyUsd?: number;
            codexSubscriptionSeatMultiplier?: number;
            codexSubscriptionMonthlyTokens?: number;
            codexWeeklyTokenAllowance?: number;
            codexObservedWeeklyTokens?: number;
        };
    };
    configPath: string;
}
export declare const configFileName = ".agent-runner.json";
export declare function loadEnvironment(projectRoot: string): void;
export declare function readConfigFile(projectRoot: string): AgentRunnerConfigFile;
export declare function resolveConfig(projectRootInput?: string): ResolvedConfig;
export declare function createDefaultConfig(projectRoot: string): AgentRunnerConfigFile;
export {};
