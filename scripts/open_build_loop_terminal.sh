#!/bin/zsh
# Runs INSIDE the visible Terminal window (launched by the LaunchAgent via
# osascript) -- never invoked directly by launchd itself. macOS blocks a
# headless launchd process from reading anything under ~/Documents (TCC
# privacy protection), so launchd's only job is to open Terminal; this
# script does the real work of deciding whether there's a card to run.

# Self-resolving, not hardcoded: this script's content is identical in the
# main repo and in the loop's dedicated worktree (../smb-commerce-os-loop,
# see docs/design/17) -- it must operate on wherever it actually lives, or a
# hardcoded main-repo path here would silently undo the worktree fix by
# cd-ing straight back to whatever branch the primary checkout has.
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_FILE="$REPO_DIR/scripts/.loop.lock"

cd "$REPO_DIR" || { echo "cannot cd into $REPO_DIR"; exit 1; }

if [ -f "$LOCK_FILE" ]; then
  pid=$(cat "$LOCK_FILE" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Build loop already running (pid $pid). Nothing to do here."
    exit 0
  fi
fi

next_card=$(python3 scripts/run_build_loop.py --dry-run 2>&1)
if [[ ! "$next_card" =~ ^D[0-9]{3}$ ]]; then
  echo "No current card ready ($next_card). Nothing to do here."
  exit 0
fi

suggestion=$(python3 scripts/run_build_loop.py --show-suggestion 2>&1)
count=$(echo "$suggestion" | head -1)
reason=$(echo "$suggestion" | tail -n +2)
echo "Current card: $next_card -- auto-suggested $count card(s) ($reason)"
exec python3 scripts/run_build_loop.py --auto
