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

## What's actually scheduled right now

A LaunchAgent at `~/Library/LaunchAgents/com.smbcos.buildloop.plist` fires
every hour (`StartInterval` 3600) plus once immediately on load
(`RunAtLoad`). It runs **only** `/usr/bin/osascript`, telling Terminal to open
a window and run `scripts/open_build_loop_terminal.sh` inside it.

**Why the indirection through osascript/Terminal:** macOS blocks a headless
launchd process from reading anything under `~/Documents/...` at all (a TCC
privacy protection on the Documents folder) — a launchd job that tried to
exec a script or even `ls` this repo directly failed with `Operation not
permitted`, no prompt, no way around it from a background process. Terminal,
as a normal foreground app, isn't blocked the same way. So launchd's only
job is "open Terminal"; everything else — the lock check, the dry-run check,
running the actual loop — happens inside `open_build_loop_terminal.sh`,
executed by Terminal's own shell, not launchd's.

`open_build_loop_terminal.sh` checks the PID lock and does a `--dry-run`
before committing to a window: if another run is already active or there's no
current card, it prints one line and exits — the window stays open (harmless,
just an idle prompt) rather than closing itself, since closing it
programmatically risks touching windows that aren't ours. If there's a real
card, it runs `python3 scripts/run_build_loop.py --max-cards 6` in that same
window so you can watch it live.

Useful commands:

```bash
launchctl print gui/$(id -u)/com.smbcos.buildloop   # status, last exit code
launchctl bootout gui/$(id -u)/com.smbcos.buildloop # stop/unload
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.smbcos.buildloop.plist  # reload
```

To change the cadence, edit `StartInterval` (seconds) in the plist, then
bootout + bootstrap to reload it.

## Fully headless alternative (no visible window)

`scripts/run_build_loop.sh` (redirects all output to
`scripts/loop_runs/cron.log`) still works as a plain cron entry if you'd
rather not have Terminal windows appear at all — same TCC caveat does not
apply to `cron` jobs the same way `launchd` background agents hit it in
practice, but if you see the same `Operation not permitted` failure from
cron, route it through the same osascript/Terminal indirection above.

```
*/15 * * * * /Users/harleybarrales/Documents/Git\ Code\ Base/smb-commerce-os/scripts/run_build_loop.sh
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
