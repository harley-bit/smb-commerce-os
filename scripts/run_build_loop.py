#!/usr/bin/env python3
"""Token-maxing build loop driver for SMB Commerce OS.

Claude Code already knows the full build protocol from CLAUDE.md (write the
failing test, implement, run the local gate, answer the security check, write
the log, update the calendar, update BUILD_STATE.md, commit). This script does
NOT reimplement any of that. Its only job is to:

  1. Read docs/BUILD_STATE.md to find the current card.
  2. Invoke `claude -p` in this repo, telling it to execute that card per
     CLAUDE.md's protocol end to end.
  3. Check whether the current-card pointer actually advanced afterward.
  4. Detect a usage-limit stop vs. a stalled/blocked card vs. real progress.
  5. Repeat until told to stop, the limit is hit, or nothing advances.

Safe to run by hand or from cron/launchd: it takes a PID lock so overlapping
scheduled runs are a no-op, and it uses distinct exit codes so a scheduler can
tell "usage limit, try again later" apart from "stalled, needs a human".

Usage:
    python3 scripts/run_build_loop.py                # run until limit/blocked
    python3 scripts/run_build_loop.py --max-cards 3   # cap this invocation
    python3 scripts/run_build_loop.py --auto          # adaptive cap for ~1 hour (see below)
    python3 scripts/run_build_loop.py --once          # exactly one card
    python3 scripts/run_build_loop.py --dry-run       # show next card, exit
    python3 scripts/run_build_loop.py --show-suggestion  # print the --auto card count and why, without running

--auto: every completed card's actual wall-clock time is recorded next to its
own heuristic "Est. Duration" figure in scripts/loop_runs/card_timings.jsonl.
From the median (actual / estimated) ratio over recent completions, --auto
predicts each *upcoming* card's actual time as (that card's own estimate x
ratio) and greedily packs cards into a ~1-hour budget -- so the count adapts
per phase using each card's own estimate, not a flat average of past cards
that may have been much easier or harder. Falls back to a fixed default
until enough samples exist.
"""

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUILD_STATE = REPO / "docs" / "BUILD_STATE.md"
CARDS_DIR = REPO / "docs" / "cards"
LOGS_DIR = REPO / "docs" / "logs"
RUN_LOG_DIR = REPO / "scripts" / "loop_runs"
LOCK_FILE = REPO / "scripts" / ".loop.lock"
TIMINGS_FILE = REPO / "scripts" / "loop_runs" / "card_timings.jsonl"

DAY_ID_RE = re.compile(r"\bD\d{3}\b")
ESTIMATE_RE = re.compile(r"Estimated build duration \(AI-assisted session\):\*\*\s*([\d.]+)h")

AUTO_DEFAULT_CARDS = 5     # used until enough real samples exist
AUTO_MIN_SAMPLES = 3       # fewer completions than this -> not enough signal to trust a ratio
AUTO_HISTORY_WINDOW = 20   # only the most recent N completions inform the ratio
AUTO_MAX_LOOKAHEAD = 20    # never suggest more than this many cards regardless of pace
AUTO_BUDGET_SECONDS = 3600 * 0.9  # target 90% of the hour, leaving a buffer

USAGE_LIMIT_MARKERS = (
    "usage limit",
    "rate limit",
    "quota exceeded",
    "resets at",
    "try again later",
    "please try again in",
    "limit reached",
)

EXIT_OK = 0
EXIT_USAGE_LIMIT = 75   # transient: reschedule and retry later
EXIT_STALLED = 3        # card ran but did not advance: needs a human look
EXIT_LOCKED = 4         # another instance is already running
EXIT_DIRTY_TREE = 5     # uncommitted changes left from a prior partial run
EXIT_ERROR = 1


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
    print(f"[{ts}] {msg}", flush=True)


class Lock:
    def __enter__(self):
        if LOCK_FILE.exists():
            stale = True
            try:
                pid = int(LOCK_FILE.read_text().strip())
                os.kill(pid, 0)
                stale = False
            except (ValueError, ProcessLookupError, PermissionError):
                stale = True
            if not stale:
                log(f"Another loop run is already active (pid in {LOCK_FILE}). Exiting.")
                raise SystemExit(EXIT_LOCKED)
            log("Found a stale lock file, taking over.")
        LOCK_FILE.write_text(str(os.getpid()))
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if LOCK_FILE.exists() and LOCK_FILE.read_text().strip() == str(os.getpid()):
                LOCK_FILE.unlink()
        except OSError:
            pass


def get_current_card() -> str:
    text = BUILD_STATE.read_text()
    section = text.split("## Current card", 1)
    if len(section) < 2:
        raise RuntimeError("Could not find a '## Current card' section in BUILD_STATE.md")
    tail = section[1].split("## ", 1)[0]
    m = DAY_ID_RE.search(tail)
    if not m:
        raise RuntimeError("Could not find a Day ID in BUILD_STATE.md's Current card section")
    return m.group(0)


def get_estimated_hours(day_id: str) -> float | None:
    card_file = CARDS_DIR / f"{day_id}.md"
    if not card_file.exists():
        return None
    m = ESTIMATE_RE.search(card_file.read_text())
    return float(m.group(1)) if m else None


def record_card_timing(day_id: str, elapsed_seconds: float) -> None:
    estimated_hours = get_estimated_hours(day_id)
    entry = {
        "day": day_id,
        "estimated_hours": estimated_hours,
        "actual_seconds": round(elapsed_seconds, 1),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    RUN_LOG_DIR.mkdir(parents=True, exist_ok=True)
    with TIMINGS_FILE.open("a") as f:
        f.write(json.dumps(entry) + "\n")

    # Commit immediately -- this write happens after the card's own commit,
    # so if left uncommitted it becomes a stray local change that blocks the
    # *next* card via working_tree_dirty(). Local-only commit (no push), same
    # as every other commit this script's card runs make.
    subprocess.run(["git", "add", str(TIMINGS_FILE)], cwd=REPO, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", f"chore: record {day_id}'s actual timing for the adaptive scheduler"],
        cwd=REPO, capture_output=True,
    )


def load_recent_timings(limit: int = AUTO_HISTORY_WINDOW) -> list[dict]:
    if not TIMINGS_FILE.exists():
        return []
    entries = []
    for line in TIMINGS_FILE.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries[-limit:]


def next_day_id(day_id: str, offset: int) -> str:
    n = int(day_id[1:]) + offset
    return f"D{n:03d}"


def upcoming_estimates(start_day_id: str, limit: int) -> list[tuple[str, float]]:
    result = []
    for i in range(limit):
        day = next_day_id(start_day_id, i)
        hours = get_estimated_hours(day)
        if hours is None:
            break
        result.append((day, hours))
    return result


def suggest_max_cards() -> tuple[int, str]:
    """Returns (count, human-readable reasoning) for --auto."""
    timings = [t for t in load_recent_timings() if t.get("estimated_hours")]

    if len(timings) < AUTO_MIN_SAMPLES:
        return AUTO_DEFAULT_CARDS, (
            f"only {len(timings)} timed completion(s) so far (need {AUTO_MIN_SAMPLES}) -- "
            f"using the fixed default of {AUTO_DEFAULT_CARDS} until there's enough signal"
        )

    ratios = [t["actual_seconds"] / (t["estimated_hours"] * 3600) for t in timings]
    ratio = statistics.median(ratios)

    try:
        current = get_current_card()
    except RuntimeError as e:
        return AUTO_DEFAULT_CARDS, f"could not read current card ({e}) -- using default"

    upcoming = upcoming_estimates(current, AUTO_MAX_LOOKAHEAD)
    if not upcoming:
        return AUTO_DEFAULT_CARDS, f"no card files found from {current} onward -- using default"

    accumulated = 0.0
    count = 0
    for day, est_hours in upcoming:
        predicted = est_hours * 3600 * ratio
        if count >= 1 and accumulated + predicted > AUTO_BUDGET_SECONDS:
            break
        accumulated += predicted
        count += 1

    count = max(1, min(count, AUTO_MAX_LOOKAHEAD))
    reasoning = (
        f"median actual/estimate ratio over last {len(timings)} completions is {ratio:.3f}x "
        f"({ratio*3600:.0f}s of actual work per estimated hour); packing {upcoming[0][0]}.."
        f"{upcoming[min(count, len(upcoming))-1][0]} (predicted {accumulated:.0f}s) into a "
        f"{AUTO_BUDGET_SECONDS:.0f}s budget -> {count} card(s)"
    )
    return count, reasoning


def working_tree_dirty() -> bool:
    result = subprocess.run(
        ["git", "status", "--porcelain"], cwd=REPO, capture_output=True, text=True
    )
    return bool(result.stdout.strip())


def build_prompt(day_id: str) -> str:
    return (
        f"Execute the current build card, {day_id}, now. Read CLAUDE.md and "
        f"docs/BUILD_STATE.md first, then docs/cards/{day_id}.md. Follow "
        f"CLAUDE.md's build protocol exactly, in order: confirm the tree is "
        f"green before starting; write the failing test first where the "
        f"protocol requires it; implement the smallest change that satisfies "
        f"the card's acceptance criteria; run the local gate; answer the "
        f"card's security check; write docs/logs/{day_id}.md from the "
        f"template; update {day_id}'s row in docs/BUILD_CALENDAR.md; update "
        f"docs/BUILD_STATE.md's current-card pointer to the next unblocked "
        f"Day ID; commit with the day ID in the commit message. "
        f"If you cannot finish {day_id} in this run, mark it Carried with a "
        f"one-sentence reason in the log and in docs/BUILD_STATE.md, and "
        f"leave the current-card pointer on {day_id} rather than advancing "
        f"it or marking it Done. Never mark a gate passed without its test "
        f"actually passing."
    )


def run_claude(prompt: str, transcript_path: Path) -> tuple[int, str]:
    # `claude -p` fully buffers its stdout when it isn't attached to a real
    # terminal, so a plain subprocess.PIPE shows nothing until the whole run
    # finishes. Route it through `script` to allocate a pseudo-tty: output
    # streams live to whatever terminal this process itself is running in,
    # while `script` also duplicates it into transcript_path for the record.
    cmd = [
        "script", "-q", str(transcript_path),
        "claude", "-p", prompt,
        "--permission-mode", "auto",
    ]
    log(f"Running: claude -p <{len(prompt)} char prompt> (cwd={REPO}, live via script -> {transcript_path.name})")
    try:
        proc = subprocess.run(cmd, cwd=REPO)
    except FileNotFoundError:
        log("ERROR: `script` or `claude` not found on PATH.")
        return EXIT_ERROR, ""
    try:
        output = transcript_path.read_text(errors="replace")
    except OSError:
        output = ""
    return proc.returncode, output


def looks_like_usage_limit(output: str) -> bool:
    lowered = output.lower()
    return any(marker in lowered for marker in USAGE_LIMIT_MARKERS)


def run_one_card(sleep_after: int) -> int:
    if working_tree_dirty():
        log(
            "Working tree has uncommitted changes -- likely a partial run "
            "was cut off. Not starting a new card. Run `git status` and "
            "resolve manually, then re-run the loop."
        )
        return EXIT_DIRTY_TREE

    before = get_current_card()
    card_file = CARDS_DIR / f"{before}.md"
    if not card_file.exists():
        log(f"No card file for {before} -- all cards done, or BUILD_STATE.md points past D176.")
        return EXIT_OK

    log(f"Current card: {before}")
    RUN_LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    transcript_path = RUN_LOG_DIR / f"{ts}_{before}.log"

    started = time.time()
    returncode, output = run_claude(build_prompt(before), transcript_path)
    elapsed = time.time() - started

    if returncode == EXIT_ERROR and not output:
        return EXIT_ERROR

    if looks_like_usage_limit(output):
        log(f"Usage limit signal detected after {before} ({elapsed:.0f}s). Stopping for now.")
        return EXIT_USAGE_LIMIT

    after = get_current_card()
    if after != before:
        log(f"{before} -> Done. Next card: {after}. ({elapsed:.0f}s)")
        expected_log = LOGS_DIR / f"{before}.md"
        if not expected_log.exists():
            log(
                f"WARNING: current-card pointer advanced past {before} but "
                f"{expected_log} does not exist -- log the discrepancy and "
                f"check manually."
            )
        record_card_timing(before, elapsed)
        if sleep_after > 0:
            time.sleep(sleep_after)
        return EXIT_OK

    if returncode != 0:
        log(f"claude exited {returncode} and {before} did not advance ({elapsed:.0f}s). Stalled.")
    else:
        log(f"{before} did not advance (Carried or Blocked, per its log). Stopping. ({elapsed:.0f}s)")
    return EXIT_STALLED


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cap_group = parser.add_mutually_exclusive_group()
    cap_group.add_argument("--max-cards", type=int, default=None, help="Stop after this many cards this run (default: unlimited).")
    cap_group.add_argument("--auto", action="store_true", help="Adaptively cap this run to roughly fit a 1-hour window, based on recent actual-vs-estimated performance (see module docstring).")
    parser.add_argument("--once", action="store_true", help="Run exactly one card, then exit.")
    parser.add_argument("--sleep", type=int, default=10, help="Seconds to pause between cards (default: 10).")
    parser.add_argument("--dry-run", action="store_true", help="Print the current card and exit, without running anything.")
    parser.add_argument("--show-suggestion", action="store_true", help="Print the --auto card count and reasoning, then exit, without running anything.")
    args = parser.parse_args()

    if args.dry_run:
        try:
            print(get_current_card())
        except RuntimeError as e:
            print(f"error: {e}", file=sys.stderr)
            return EXIT_ERROR
        return EXIT_OK

    if args.show_suggestion:
        count, reasoning = suggest_max_cards()
        print(f"{count}\n{reasoning}")
        return EXIT_OK

    if args.once:
        max_cards = 1
    elif args.auto:
        max_cards, reasoning = suggest_max_cards()
        log(f"--auto suggests {max_cards} card(s): {reasoning}")
    else:
        max_cards = args.max_cards
    count = 0

    with Lock():
        while max_cards is None or count < max_cards:
            code = run_one_card(sleep_after=args.sleep)
            if code != EXIT_OK:
                return code
            count += 1
        log(f"Reached --max-cards limit ({max_cards}). Stopping cleanly.")
        return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
