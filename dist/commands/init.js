import fs from "node:fs";
import { createDefaultConfig, configFileName } from "../config.js";
import { installDevcontainerTelemetryAutostart } from "../devcontainer-autostart.js";
export async function initProject(projectRoot, options = {}) {
    const configPath = `${projectRoot}/${configFileName}`;
    let created = false;
    if (!fs.existsSync(configPath) || options.force) {
        const config = createDefaultConfig(projectRoot);
        await fs.promises.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
        created = true;
    }
    const telemetryAutostart = options.telemetryAutostart === false
        ? undefined
        : await installDevcontainerTelemetryAutostart(projectRoot);
    return { path: configPath, created, ...(telemetryAutostart ? { telemetryAutostart } : {}) };
}
//# sourceMappingURL=init.js.map