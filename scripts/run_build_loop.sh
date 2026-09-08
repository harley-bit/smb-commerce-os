#!/bin/zsh
# Cron/launchd-safe wrapper around run_build_loop.py.
#
# cron and launchd give a minimal, login-shell-free PATH -- `node`, `pnpm`,
# and `claude` may not resolve without this. Adjust the PATH/nvm lines below
# to match how this machine actually has them installed.

set -uo pipefail

REPO_DIR="/Users/harleybarrales/Documents/Git Code Base/smb-commerce-os"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  \. "$HOME/.nvm/nvm.sh" --no-use
  nvm use --silent default >/dev/null 2>&1 || true
fi

cd "$REPO_DIR" || exit 1
mkdir -p scripts/loop_runs

python3 scripts/run_build_loop.py "$@" >> scripts/loop_runs/cron.log 2>&1
exit $?
