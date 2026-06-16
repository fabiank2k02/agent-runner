import { execa } from "execa";
export class RealShellExecutor {
    async run(command, args = [], options = {}) {
        if (options.dryRun) {
            return {
                command,
                args,
                stdout: formatCommand(command, args),
                stderr: "",
                exitCode: 0
            };
        }
        const child = execa(command, args, {
            cwd: options.cwd,
            env: options.env,
            input: options.input,
            reject: false,
            stdio: options.stdio ?? "pipe"
        });
        const result = await child;
        return {
            command,
            args,
            stdout: typeof result.stdout === "string" ? result.stdout : "",
            stderr: typeof result.stderr === "string" ? result.stderr : "",
            exitCode: result.exitCode ?? 0
        };
    }
}
export function formatCommand(command, args = []) {
    return [command, ...args].join(" ");
}
export async function requireSuccess(result, message) {
    const resolved = await result;
    if (resolved.exitCode !== 0) {
        const details = resolved.stderr || resolved.stdout || `${resolved.command} exited ${resolved.exitCode}`;
        throw new Error(`${message}\n${details}`);
    }
    return resolved;
}
//# sourceMappingURL=shell.js.map