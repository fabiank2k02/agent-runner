import { dirnameRemote, quoteRemotePath } from "../quote.js";
export async function bootstrap(context) {
    const { layout, remote } = context;
    const script = `
set -euo pipefail
mkdir -p ${quoteRemotePath(layout.remoteProjectParent)} ${quoteRemotePath(layout.remoteProjectLogDir)} ${quoteRemotePath(dirnameRemote(layout.remoteCodexAuthFile))} ${quoteRemotePath(dirnameRemote(layout.remoteProjectStateFile))}
if command -v sudo >/dev/null 2>&1; then SUDO=sudo; else SUDO=; fi
if command -v cloud-init >/dev/null 2>&1; then
  cloud-init status --wait >/dev/null 2>&1 || true
fi
wait_for_apt() {
  local started
  started="$(date +%s)"
  while fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock /var/lib/apt/lists/lock >/dev/null 2>&1; do
    if [ $(( "$(date +%s)" - started )) -gt 300 ]; then
      echo "Timed out waiting for apt/dpkg locks." >&2
      return 1
    fi
    sleep 5
  done
}

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
  wait_for_apt
  $SUDO apt-get update
  wait_for_apt
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
//# sourceMappingURL=bootstrap.js.map