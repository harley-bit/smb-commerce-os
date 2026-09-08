# Running the token-maxing build loop

`scripts/run_build_loop.py` drives Claude Code through cards back-to-back. It
does not implement the build protocol itself — CLAUDE.md already tells Claude
how to run a card, log it, update the calendar, and commit. The script's only
job is: find the current card, invoke `claude -p` on it, check whether the
current-card pointer actually moved, and repeat until something stops it.

## Run it by hand

```bash
cd "/Users/harleybarrales/Documents/Git Code Base/smb-commerce-os"
python3 scripts/run_build_loop.py            # run until the usage limit hits or a card stalls
python3 scripts/run_build_loop.py --once     # exactly one card, then stop
python3 scripts/run_build_loop.py --max-cards 3
python3 scripts/run_build_loop.py --dry-run  # print the current card, do nothing
```

Output streams to the terminal and is also saved per-card under
`scripts/loop_runs/{timestamp}_{DAY_ID}.log`.

## Exit codes (what a scheduler should do with each)

| Code | Meaning | What to do |
|---|---|---|
| 0 | Ran to completion — either hit `--max-cards`/`--once`, or all 176 cards are done | Nothing; a later scheduled run just continues |
| 75 | Usage limit signal detected mid-run | Transient — just let the next scheduled run retry |
| 3 | A card ran but the current-card pointer didn't advance (Carried/Blocked, or `claude` errored) | Read `docs/BUILD_STATE.md` and the card's log — needs a human decision before the loop can safely continue |
| 4 | Another instance is already running (PID lock held) | Nothing; expected if a scheduled run overlaps a manual one |
| 5 | Working tree has uncommitted changes (a prior run was likely cut off mid-card) | Run `git status`, resolve by hand, then re-run |
| 1 | `claude` CLI not found, or another hard error | Check PATH / installation |

The loop deliberately **stops** rather than guessing on 3, 4, and 5 — none of
those are safe to paper over automatically.

## Scheduling on macOS

launchd is the native mechanism and survives reboots better than cron. Example
`~/Library/LaunchAgents/com.smbcos.buildloop.plist` (runs every 30 minutes;
each run is a no-op via the PID lock if the previous one is still going, and a
no-op via the exit-code table above if there's nothing safe to do):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.smbcos.buildloop</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/harleybarrales/Documents/Git Code Base/smb-commerce-os/scripts/run_build_loop.sh</string>
  </array>
  <key>StartInterval</key><integer>1800</integer>
  <key>StandardOutPath</key><string>/tmp/smbcos-buildloop.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/smbcos-buildloop.err.log</string>
</dict>
</plist>
```

Load it with `launchctl load ~/Library/LaunchAgents/com.smbcos.buildloop.plist`.
Unload with `launchctl unload` when you want to pause the loop entirely.

Cron alternative (`crontab -e`), same cadence:

```
*/30 * * * * /Users/harleybarrales/Documents/Git\ Code\ Base/smb-commerce-os/scripts/run_build_loop.sh
```

## Notes

- The script never bypasses permissions — it relies on `.claude/settings.json`'s
  existing project-scoped allowlist. Anything outside that allowlist simply
  can't run in a non-interactive `claude -p` session, by design.
- Exit code 3 (stalled) and 5 (dirty tree) both mean: **stop scheduling until
  a human looks.** Don't loosen these checks to "just keep going" — that's
  exactly the failure mode that would let a broken build compound silently
  across dozens of unattended cards.
- Recalibrate `--sleep` and the launchd interval once you've seen real
  per-card wall-clock time in `scripts/loop_runs/` — the 1.0h–4.0h estimates
  in the calendar are planning figures, not what a single `claude -p` call
  actually takes.
