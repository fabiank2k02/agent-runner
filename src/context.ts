import { resolveConfig, type ResolvedConfig } from "./config.js";
import { resolveLayout, type RunnerLayout } from "./paths.js";
import { SshRemoteClient, type RemoteClient } from "./remote.js";
import { RealShellExecutor, type ShellExecutor } from "./shell.js";

export interface CommandContext {
  config: ResolvedConfig;
  layout: RunnerLayout;
  executor: ShellExecutor;
  remote: RemoteClient;
  dryRun: boolean;
}

export function createCommandContext(projectRoot: string, options: { dryRun?: boolean } = {}): CommandContext {
  const config = resolveConfig(projectRoot);
  const layout = resolveLayout(config);
  const executor = new RealShellExecutor();
  const dryRun = options.dryRun ?? false;
  return {
    config,
    layout,
    executor,
    remote: new SshRemoteClient(config, executor, dryRun),
    dryRun
  };
}
