import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { expandHome, projectSlugFromPath } from "./paths.js";

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
        model: z.string().min(1).optional(),
        extraArgs: z.array(z.string()).default([])
      })
      .default({ sandbox: "workspace-write", approval: "never", extraArgs: [] }),
    rsync: z
      .object({
        excludes: z.array(z.string()).default([])
      })
      .default({ excludes: [] })
  });

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
    model?: string;
    extraArgs: string[];
  };
  rsync: {
    excludes: string[];
  };
  configPath: string;
}

export const configFileName = ".agent-runner.json";

export function loadEnvironment(projectRoot: string): void {
  const envPath = path.join(projectRoot, ".env");
  const localEnvPath = path.join(projectRoot, ".env.local");

  if (fs.existsSync(envPath)) {
    loadDotenv({ path: envPath, override: false, quiet: true });
  }
  if (fs.existsSync(localEnvPath)) {
    loadDotenv({ path: localEnvPath, override: true, quiet: true });
  }
}

export function readConfigFile(projectRoot: string): AgentRunnerConfigFile {
  const configPath = path.join(projectRoot, configFileName);
  if (!fs.existsSync(configPath)) {
    return configFileSchema.parse({});
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return configFileSchema.parse(parsed);
}

export function resolveConfig(projectRootInput = process.cwd()): ResolvedConfig {
  const projectRoot = path.resolve(projectRootInput);
  loadEnvironment(projectRoot);
  const fileConfig = readConfigFile(projectRoot);

  const remoteRoot =
    fileConfig.remote?.root ?? process.env.AGENT_RUNNER_REMOTE_ROOT ?? "~/agent-runner";
  const codexAuthSource =
    fileConfig.codexAuthSource ??
    process.env.AGENT_RUNNER_CODEX_AUTH_SOURCE ??
    "~/.codex/auth.json";

  return {
    projectRoot,
    projectSlug: fileConfig.projectSlug ?? projectSlugFromPath(projectRoot),
    remote: {
      host: fileConfig.remote?.host ?? process.env.AGENT_RUNNER_REMOTE_HOST,
      user: fileConfig.remote?.user ?? process.env.AGENT_RUNNER_REMOTE_USER,
      port:
        fileConfig.remote?.port ??
        Number.parseInt(process.env.AGENT_RUNNER_REMOTE_PORT ?? "22", 10),
      sshKey: fileConfig.remote?.sshKey ?? process.env.AGENT_RUNNER_REMOTE_SSH_KEY,
      password: fileConfig.remote?.password ?? process.env.AGENT_RUNNER_REMOTE_PASSWORD,
      root: remoteRoot
    },
    codexAuthSource: expandHome(codexAuthSource),
    devcontainer: fileConfig.devcontainer,
    codex: fileConfig.codex,
    rsync: fileConfig.rsync,
    configPath: path.join(projectRoot, configFileName)
  };
}

export function createDefaultConfig(projectRoot: string): AgentRunnerConfigFile {
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
      extraArgs: []
    },
    rsync: {
      excludes: []
    }
  };
}
