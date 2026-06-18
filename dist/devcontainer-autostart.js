import fs from "node:fs";
import path from "node:path";
export const telemetryAutostartKey = "agent-runner-telemetry";
export const preservedPostStartKey = "project-post-start";
export function telemetryAutostartCommand() {
    return [
        "sh -lc '",
        "cd \"${containerWorkspaceFolder}\" 2>/dev/null || cd \"$PWD\"; ",
        "if command -v agent-runner >/dev/null 2>&1; then ",
        "agent-runner -C \"$PWD\" telemetry start; ",
        "elif [ -x ./node_modules/.bin/agent-runner ]; then ",
        "./node_modules/.bin/agent-runner -C \"$PWD\" telemetry start; ",
        "elif [ -f ./dist/cli.js ]; then ",
        "node ./dist/cli.js -C \"$PWD\" telemetry start; ",
        "else ",
        "echo \"agent-runner telemetry autostart skipped: CLI not found\" >&2; ",
        "fi",
        "' || true"
    ].join("");
}
export async function installDevcontainerTelemetryAutostart(projectRoot) {
    const devcontainerPath = devcontainerConfigPath(projectRoot);
    if (!fs.existsSync(devcontainerPath)) {
        return {
            path: devcontainerPath,
            exists: false,
            installed: false,
            changed: false,
            reason: "missing .devcontainer/devcontainer.json"
        };
    }
    const raw = await fs.promises.readFile(devcontainerPath, "utf8");
    const config = parseDevcontainerJson(raw, devcontainerPath);
    const command = telemetryAutostartCommand();
    const updated = withTelemetryAutostart(config, command);
    const next = `${JSON.stringify(updated, null, 2)}\n`;
    const changed = raw !== next;
    if (changed) {
        await fs.promises.writeFile(devcontainerPath, next);
    }
    return {
        path: devcontainerPath,
        exists: true,
        installed: true,
        changed,
        command
    };
}
export async function devcontainerTelemetryAutostartStatus(projectRoot) {
    const devcontainerPath = devcontainerConfigPath(projectRoot);
    if (!fs.existsSync(devcontainerPath)) {
        return {
            path: devcontainerPath,
            exists: false,
            installed: false,
            changed: false,
            reason: "missing .devcontainer/devcontainer.json"
        };
    }
    const raw = await fs.promises.readFile(devcontainerPath, "utf8");
    const config = parseDevcontainerJson(raw, devcontainerPath);
    const installed = hasTelemetryAutostart(config);
    return {
        path: devcontainerPath,
        exists: true,
        installed,
        changed: false,
        command: installed ? telemetryAutostartCommand() : undefined,
        reason: installed ? undefined : "postStartCommand does not include agent-runner telemetry"
    };
}
export function withTelemetryAutostart(config, command = telemetryAutostartCommand()) {
    const current = config.postStartCommand;
    if (isPlainObject(current)) {
        return {
            ...config,
            postStartCommand: {
                ...current,
                [telemetryAutostartKey]: command
            }
        };
    }
    if (current === undefined) {
        return {
            ...config,
            postStartCommand: {
                [telemetryAutostartKey]: command
            }
        };
    }
    return {
        ...config,
        postStartCommand: {
            [preserveKeyFor(current)]: current,
            [telemetryAutostartKey]: command
        }
    };
}
function hasTelemetryAutostart(config) {
    const current = config.postStartCommand;
    return isPlainObject(current) && typeof current[telemetryAutostartKey] === "string";
}
function preserveKeyFor(current) {
    if (isPlainObject(current) && preservedPostStartKey in current) {
        return `${preservedPostStartKey}-1`;
    }
    return preservedPostStartKey;
}
function parseDevcontainerJson(raw, devcontainerPath) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("devcontainer config must be a JSON object");
        }
        return parsed;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to parse ${devcontainerPath}: ${message}`);
    }
}
function devcontainerConfigPath(projectRoot) {
    return path.join(projectRoot, ".devcontainer", "devcontainer.json");
}
function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
//# sourceMappingURL=devcontainer-autostart.js.map