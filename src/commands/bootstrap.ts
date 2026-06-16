import type { CommandContext } from "../context.js";
import { dirnameRemote, quoteRemotePath } from "../quote.js";

export async function bootstrap(context: CommandContext): Promise<void> {
  const { layout, remote } = context;
  const script = `
set -euo pipefail
mkdir -p ${quoteRemotePath(layout.remoteProjectParent)} ${quoteRemotePath(layout.remoteProjectLogDir)} ${quoteRemotePath(dirnameRemote(layout.remoteCodexAuthFile))} ${quoteRemotePath(dirnameRemote(layout.remoteProjectStateFile))}
if command -v sudo >/dev/null 2>&1; then SUDO=sudo; else SUDO=; fi

need_apt=0
for bin in rsync tmux docker node npm; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    need_apt=1
  fi
done

if [ "$need_apt" = "1" ]; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Missing dependencies and apt-get is unavailable. Install rsync, tmux, docker, node, and npm manually." >&2
    exit 1
  fi
  $SUDO apt-get update
  $SUDO apt-get install -y rsync tmux docker.io nodejs npm
fi

if ! command -v devcontainer >/dev/null 2>&1; then
  $SUDO npm install -g @devcontainers/cli
fi

if ! command -v codex >/dev/null 2>&1; then
  $SUDO npm install -g @openai/codex
fi

docker --version >/dev/null
devcontainer --version >/dev/null
tmux -V >/dev/null
rsync --version >/dev/null
codex --version >/dev/null || true
`.trim();

  await remote.run(script);
}
