import fs from "node:fs";
import { createDefaultConfig, configFileName } from "../config.js";
import {
  installDevcontainerTelemetryAutostart,
  type DevcontainerTelemetryAutostartResult
} from "../devcontainer-autostart.js";

export interface InitResult {
  path: string;
  created: boolean;
  telemetryAutostart?: DevcontainerTelemetryAutostartResult;
}

export async function initProject(
  projectRoot: string,
  options: { force?: boolean; telemetryAutostart?: boolean } = {}
): Promise<InitResult> {
  const configPath = `${projectRoot}/${configFileName}`;
  let created = false;
  if (!fs.existsSync(configPath) || options.force) {
    const config = createDefaultConfig(projectRoot);
    await fs.promises.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    created = true;
  }

  const telemetryAutostart =
    options.telemetryAutostart === false
      ? undefined
      : await installDevcontainerTelemetryAutostart(projectRoot);

  return { path: configPath, created, ...(telemetryAutostart ? { telemetryAutostart } : {}) };
}
