import { quoteRemotePath, shellQuote } from "../quote.js";
export async function upDevcontainer(context) {
    const { config, layout, remote } = context;
    const extra = config.devcontainer.extraArgs.map(shellQuote).join(" ");
    const workspace = quoteRemotePath(layout.remoteProjectDir);
    const upCommand = `devcontainer up --workspace-folder ${workspace}${extra ? ` ${extra}` : ""}`;
    const devcontainerStarted = Date.now();
    await remote.run(upCommand);
    const devcontainerReadyDurationMs = Date.now() - devcontainerStarted;
    const installScript = `
set -e
install_codex() {
  if npm install -g @openai/codex; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo npm install -g @openai/codex
    return $?
  fi
  npm install -g --prefix "$HOME/.local" @openai/codex
}
export PATH="$HOME/.local/bin:$PATH"
if ! command -v codex >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    install_codex
  elif command -v apt-get >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then SUDO=sudo; else SUDO=; fi
    $SUDO apt-get update
    $SUDO apt-get install -y nodejs npm
    install_codex
  else
    echo "Codex is missing and npm is unavailable. Add Node/npm or Codex to this devcontainer." >&2
    exit 42
  fi
fi
mkdir -p "$HOME/.codex"
cat > "$HOME/.codex/auth.json"
chmod 600 "$HOME/.codex/auth.json"
codex --version >/dev/null 2>&1 || true
`.trim();
    const execCommand = [
        `devcontainer exec --workspace-folder ${workspace} sh -lc ${shellQuote(installScript)}`,
        `< ${quoteRemotePath(layout.remoteCodexAuthFile)}`
    ].join(" ");
    const codexInstallStarted = Date.now();
    await remote.run(execCommand);
    const codexInstallDurationMs = Date.now() - codexInstallStarted;
    const appServerCheck = `devcontainer exec --workspace-folder ${workspace} sh -lc ${shellQuote('PATH="$HOME/.local/bin:$PATH" codex app-server --help >/dev/null')}`;
    const appServerStarted = Date.now();
    await remote.run(appServerCheck);
    const codexAppServerReadyDurationMs = Date.now() - appServerStarted;
    return {
        devcontainerReadyDurationMs,
        codexInstallDurationMs,
        codexAppServerReadyDurationMs
    };
}
//# sourceMappingURL=up.js.map