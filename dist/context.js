import { resolveConfig } from "./config.js";
import { resolveLayout } from "./paths.js";
import { SshRemoteClient } from "./remote.js";
import { RealShellExecutor } from "./shell.js";
export function createCommandContext(projectRoot, options = {}) {
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
//# sourceMappingURL=context.js.map