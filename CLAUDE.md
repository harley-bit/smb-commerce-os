# SMB Commerce OS — Working Rules for Claude

This file is read at the start of every session in this repo. It exists to keep sessions focused and to make the build delegable across gaps.

## Context boundary — read this first

This repo is the **build**. It is not the business-planning knowledge base. Do not read, reference, or act on anything outside `docs/design/` and this file unless the human operator explicitly asks for it in the current message.

Specifically **out of bounds by default**: fundraising plans, IP/liability structuring, sales/marketing plans, the token/valuation/GUSD concept material, or any file under `personal/Knowledge/Delusional_Reality/`. That material is reference-only context about *why* this product exists; it is never a build requirement, and past sessions have wasted effort chasing it. If a task seems to require it, stop and ask rather than pulling it in.

## What to read, every session, in order

1. This file.
2. `docs/BUILD_STATE.md` — current phase, current card ID, status, carried-over notes from the last session.
3. `docs/cards/{DAY_ID}.md` — the one card that's current. It is self-contained: task, deliverable, acceptance criteria, security check, an estimated build duration (a planning figure, not a commitment), and the exact prompt for that unit of work.
4. Only if the card references it: the **one** design doc in `docs/design/` it belongs to (see the phase table in `01_phasing_and_mvp_definition.md`). Do not re-read all 14 design docs each session — that is exactly the context bloat this file exists to prevent.

## Calendar, cards, and logs — the four-file convention

There are two calendars, deliberately, for two different readers. They must never be allowed to disagree — see the sync rule below.

- **`docs/BUILD_CALENDAR.md`** — machine-facing, read/written by Claude every session. One row per Day ID (`D001`–`D176`), Status column, links to card and log. **This is the source of truth I check and update during a run.**
- **`docs/implementation_calendar/build_calendar.xlsx`** — human-facing dashboard (the original coworker-plan spreadsheet, carried forward). Same 176 rows, plus its own Config/Phase Summary/Weekly Review/Escalation Triggers sheets. Columns `M` (Card) and `N` (Log) on the Daily Plan sheet are real hyperlinks to `docs/cards/{DAY_ID}.md` and `docs/logs/{DAY_ID}.md` — click a row's link to open that day's prompt or log directly. **Open this one when you want to browse or click through; don't hand-edit its Status column** — it's regenerated from `BUILD_CALENDAR.md`, and a manual edit there will be silently overwritten on the next sync.
- **`docs/cards/{DAY_ID}.md`** — the plan/prompt for that day, already fully generated for all 176 days (not a placeholder — task, deliverable, acceptance criteria, security check, and the exact prompt text are all written out). Read-only during execution.
- **`docs/logs/{DAY_ID}.md`** — written *after* the card runs, from `docs/logs/TEMPLATE.md`. Records what happened, the acceptance-criteria check, the security-check answer, commit hash(es), and outcome (Done / Carried / Blocked). Every log links back to its card and to `BUILD_CALENDAR.md`.

**Sync rule:** at the end of every card, update the row's Status in `docs/BUILD_CALENDAR.md` first (that's the real record), then regenerate the matching row in the `.xlsx` (Status + Notes only — never touch its hyperlink columns) so the human dashboard never drifts from what actually happened. Also update `BUILD_STATE.md`'s "current card" pointer to the next unblocked Day ID. A card is **Done** only if its acceptance criteria actually passed — otherwise it is **Carried**, with the reason in the log, and stays the current card next run.

## Operating model — WHO / WHAT / WHEN / WHERE / HOW

- **WHO** executes: the agent (Claude), acting as the developer for this repo.
- **WHAT** gets executed: the current card's prompt/plan, exactly as written in `docs/cards/{DAY_ID}.md`.
- **WHEN**: continuously, one card after another, for as long as the session can run (see "Token-maxing execution" below). There are no fixed calendar-date triggers — Day ID sequence, not a date, decides what's next. The `.xlsx` dashboard's Date column is an inherited planning artifact, not a schedule this loop waits on.
- **WHERE**: locally, strictly inside this repository (`/Users/harleybarrales/Documents/Git Code Base/smb-commerce-os`). `.claude/settings.json` pre-approves the ordinary build/test/git operations needed to run without interruption, scoped to this directory only — it is an allowlist, not a blanket permissions bypass. Remote git operations (push/pull/fetch/remote), history-rewriting or destructive git (reset --hard, clean, rebase, branch delete, config changes), sudo, and broad `rm -rf` are explicitly excluded and still require a human decision.
- **HOW**: per the build protocol below, to the acceptance criteria on the card — no shortcuts on the non-negotiable gates.

Logging is not optional and is not a summary written from memory afterward: every card's actual outcome is captured in `docs/logs/{DAY_ID}.md` as it happens, cross-linked to its card and calendar row, per the convention above.

## Token-maxing execution

This project runs as a standing loop: pick up the current card from `BUILD_STATE.md`, execute it fully per the protocol below, close it out (log + calendar + state updated, changes committed), and move to the next unblocked card — repeating until the session's usage limit is hit. When the limit resets, the next run reads `BUILD_STATE.md` cold and continues from exactly where it left off. This is why the log/calendar/state files exist: they are what make resuming after an arbitrary gap identical to resuming after five minutes.

Rules specific to this mode:
- **Never start a card without confirming the tree is green first** (`pnpm test`, or the equivalent for the current phase). A run that starts on top of an unnoticed break wastes the run.
- **One card fully closed out is worth more than two cards half-started.** If usage is likely to run out mid-card, prefer to finish and close the current card cleanly rather than starting the next one.
- **Never mark a gate (G0–G10) passed without its acceptance test actually passing in CI.** Gates are not skippable to keep the loop moving.
- If genuinely blocked (an external decision, an account not yet provisioned), record the blocker in the log and in `BUILD_STATE.md`, and move to the next unblocked card in the same phase rather than idling — per `docs/design/12_daily_build_protocol.md`.

## The build protocol

Full protocol: `docs/design/12_daily_build_protocol.md`. Summary:

1. Confirm the tree is green (`pnpm test` passes) before starting anything new.
2. Read the card: task, acceptance criteria, security check.
3. Write the failing test first — non-negotiable for `/packages/domain`, reservations, inventory, money, and authorization code.
4. Implement the smallest change that makes the test pass. Note adjacent improvements in `IMPROVEMENTS.md`; do not act on them mid-card.
5. Run the local gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:isolation`.
6. Answer the card's security question in the card's log entry.
7. Commit with the day ID in the message (e.g. `feat(reservations): ... [D047]`).
8. Update `docs/BUILD_STATE.md`: status, what got done, what's next, any blocker — in one or two sentences. This note is what lets the next session resume cold.

**Never mark a card done that isn't.** Mark it `Carried` with a one-sentence reason. A false "done" is worse than an honest "carried."

## Non-negotiable gates

- **Tenant isolation** (Gate G1) and **no-double-booking under concurrency** (Gate G3) are never waived, never skipped, never deferred. If a change to either area can't be verified with a real test in the session, the change doesn't ship.
- Card data never touches our servers — hosted fields only (`docs/design/07`).
- Prices and totals are always recomputed server-side, never trusted from a client payload.

## Scope

Full scope, no cuts: products, services, **and rentals**, on one unified catalog. Mobile is Phase 8, after the web MVP gate (G7) — it does not block G7. See `docs/design/01_phasing_and_mvp_definition.md` for the phase table and what's explicitly excluded.

## Blocking decisions status

Tracked in `docs/BUILD_STATE.md` under "Open decisions." Do not silently assume an answer to D1–D4 (`docs/design/00_README.md`) — surface it and ask.
