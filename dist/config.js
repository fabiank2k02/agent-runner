import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { expandHome, projectSlugFromPath } from "./paths.js";
import { readDigitalOceanStateSync } from "./infra-state.js";
const configFileSchema = z
    .object({
    projectSlug: z.string().min(1).optional(),
    remote: z
        .object({
        host: z.string().min(1).optional(),
        user: z.string().min(1).optional(),
        port: z.coerce.number().int().positive().optional(),
        sshKey: z.string().min(1).optional(),
        password: z.string().min(1).optional(),
        root: z.string().min(1).optional()
    })
        .optional(),
    codexAuthSource: z.string().min(1).optional(),
    devcontainer: z
        .object({
        extraArgs: z.array(z.string()).default([])
    })
        .default({ extraArgs: [] }),
    codex: z
        .object({
        sandbox: z.string().min(1).default("workspace-write"),
        approval: z.string().min(1).default("never"),
        reasoningEffort: z.string().min(1).default("xhigh"),
        yolo: z.boolean().default(true),
        model: z.string().min(1).optional(),
        extraArgs: z.array(z.string()).default([])
    })
        .default({ sandbox: "workspace-write", approval: "never", reasoningEffort: "xhigh", yolo: true, extraArgs: [] }),
    rsync: z
        .object({
        excludes: z.array(z.string()).default([])
    })
        .default({ excludes: [] }),
    digitalOcean: z
        .object({
        region: z.string().min(1).optional(),
        size: z.string().min(1).optional(),
        image: z.string().min(1).optional(),
        dropletName: z.string().min(1).optional(),
        tags: z.array(z.string()).default([])
    })
        .default({ tags: [] }),
    dashboard: z
        .object({
        enabled: z.boolean().optional(),
        endpoint: z.string().url().optional(),
        tokenEnv: z.string().min(1).default("AGENT_RUNNER_DASHBOARD_TOKEN"),
        intervalSeconds: z.coerce.number().int().min(15).default(60),
        model: z.string().min(1).optional(),
        reasoningEffort: z.string().min(1).default("low"),
        maxLogLines: z.coerce.number().int().min(20).max(1000).default(200),
        costs: z
            .object({
            digitalOceanHourlyUsd: z.coerce.number().positive().optional(),
            codexSubscriptionMonthlyUsd: z.coerce.number().positive().optional(),
            codexSubscriptionMonthlyTokens: z.coerce.number().positive().optional()
        })
            .default({})
    })
        .default({
        tokenEnv: "AGENT_RUNNER_DASHBOARD_TOKEN",
        intervalSeconds: 60,
        reasoningEffort: "low",
        maxLogLines: 200,
        costs: {}
    })
});
export const configFileName = ".agent-runner.json";
export function loadEnvironment(projectRoot) {
    const envPath = path.join(projectRoot, ".env");
    const localEnvPath = path.join(projectRoot, ".env.local");
    if (fs.existsSync(envPath)) {
        loadDotenv({ path: envPath, override: false, quiet: true });
    }
    if (fs.existsSync(localEnvPath)) {
        loadDotenv({ path: localEnvPath, override: true, quiet: true });
    }
}
export function readConfigFile(projectRoot) {
    const configPath = path.join(projectRoot, configFileName);
    if (!fs.existsSync(configPath)) {
        return configFileSchema.parse({});
    }
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return configFileSchema.parse(parsed);
}
export function resolveConfig(projectRootInput = process.cwd()) {
    const projectRoot = path.resolve(projectRootInput);
    loadEnvironment(projectRoot);
    const fileConfig = readConfigFile(projectRoot);
    const projectSlug = fileConfig.projectSlug ?? projectSlugFromPath(projectRoot);
    const digitalOceanState = readDigitalOceanStateSync(projectSlug);
    const remoteRoot = fileConfig.remote?.root ?? process.env.AGENT_RUNNER_REMOTE_ROOT ?? "~/agent-runner";
    const codexAuthSource = fileConfig.codexAuthSource ??
        process.env.AGENT_RUNNER_CODEX_AUTH_SOURCE ??
        "~/.codex/auth.json";
    const dashboardEndpoint = fileConfig.dashboard.endpoint ?? process.env.AGENT_RUNNER_DASHBOARD_ENDPOINT;
    const dashboardToken = process.env[fileConfig.dashboard.tokenEnv];
    const digitalOceanHourlyUsd = fileConfig.dashboard.costs.digitalOceanHourlyUsd ??
        numberFromEnv("AGENT_RUNNER_DASHBOARD_DO_HOURLY_USD") ??
        digitalOceanState?.activeDroplet?.hourlyPriceUsd;
    return {
        projectRoot,
        projectSlug,
        remote: {
            host: digitalOceanState?.activeDroplet?.ip ??
                fileConfig.remote?.host ??
                process.env.AGENT_RUNNER_REMOTE_HOST,
            user: digitalOceanState?.activeDroplet?.user ??
                fileConfig.remote?.user ??
                process.env.AGENT_RUNNER_REMOTE_USER,
            port: fileConfig.remote?.port ??
                Number.parseInt(process.env.AGENT_RUNNER_REMOTE_PORT ?? "22", 10),
            sshKey: digitalOceanState?.activeDroplet?.sshKeyPath ??
                fileConfig.remote?.sshKey ??
                process.env.AGENT_RUNNER_REMOTE_SSH_KEY,
            password: digitalOceanState?.activeDroplet
                ? undefined
                : fileConfig.remote?.password ?? process.env.AGENT_RUNNER_REMOTE_PASSWORD,
            root: remoteRoot
        },
        codexAuthSource: expandHome(codexAuthSource),
        devcontainer: fileConfig.devcontainer,
        codex: fileConfig.codex,
        rsync: fileConfig.rsync,
        digitalOcean: {
            token: process.env.AGENT_RUNNER_DO_TOKEN ?? process.env.DIGITALOCEAN_TOKEN,
            region: fileConfig.digitalOcean.region ?? process.env.AGENT_RUNNER_DO_REGION ?? "sgp1",
            size: fileConfig.digitalOcean.size ?? process.env.AGENT_RUNNER_DO_SIZE ?? "s-2vcpu-4gb",
            image: fileConfig.digitalOcean.image ?? process.env.AGENT_RUNNER_DO_IMAGE ?? "ubuntu-24-04-x64",
            dropletName: fileConfig.digitalOcean.dropletName ??
                process.env.AGENT_RUNNER_DO_DROPLET_NAME ??
                `agent-runner-${projectSlug}`,
            tags: fileConfig.digitalOcean.tags,
            hourlyPriceUsd: digitalOceanState?.activeDroplet?.hourlyPriceUsd
        },
        dashboard: {
            enabled: fileConfig.dashboard.enabled ?? Boolean(dashboardEndpoint && dashboardToken),
            endpoint: dashboardEndpoint,
            token: dashboardToken,
            tokenEnv: fileConfig.dashboard.tokenEnv,
            intervalSeconds: fileConfig.dashboard.intervalSeconds,
            model: fileConfig.dashboard.model ?? process.env.AGENT_RUNNER_DASHBOARD_MODEL,
            reasoningEffort: fileConfig.dashboard.reasoningEffort,
            maxLogLines: fileConfig.dashboard.maxLogLines,
            costs: {
                digitalOceanHourlyUsd,
                codexSubscriptionMonthlyUsd: fileConfig.dashboard.costs.codexSubscriptionMonthlyUsd ??
                    numberFromEnv("AGENT_RUNNER_CODEX_SUBSCRIPTION_USD"),
                codexSubscriptionMonthlyTokens: fileConfig.dashboard.costs.codexSubscriptionMonthlyTokens ??
                    numberFromEnv("AGENT_RUNNER_CODEX_SUBSCRIPTION_TOKENS")
            }
        },
        configPath: path.join(projectRoot, configFileName)
    };
}
export function createDefaultConfig(projectRoot) {
    return {
        projectSlug: projectSlugFromPath(projectRoot),
        remote: {
            root: "~/agent-runner",
            port: 22
        },
        codexAuthSource: "~/.codex/auth.json",
        devcontainer: {
            extraArgs: []
        },
        codex: {
            sandbox: "workspace-write",
            approval: "never",
            reasoningEffort: "xhigh",
            yolo: true,
            extraArgs: []
        },
        rsync: {
            excludes: []
        },
        digitalOcean: {
            tags: []
        },
        dashboard: {
            tokenEnv: "AGENT_RUNNER_DASHBOARD_TOKEN",
            intervalSeconds: 60,
            reasoningEffort: "low",
            maxLogLines: 200,
            costs: {}
        }
    };
}
function numberFromEnv(name) {
    const value = process.env[name];
    if (value === undefined || value === "") {
        return undefined;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}
//# sourceMappingURL=config.js.map