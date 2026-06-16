import fs from "node:fs";
import { createDefaultConfig, configFileName } from "../config.js";
export async function initProject(projectRoot, options = {}) {
    const configPath = `${projectRoot}/${configFileName}`;
    if (fs.existsSync(configPath) && !options.force) {
        return { path: configPath, created: false };
    }
    const config = createDefaultConfig(projectRoot);
    await fs.promises.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return { path: configPath, created: true };
}
//# sourceMappingURL=init.js.map