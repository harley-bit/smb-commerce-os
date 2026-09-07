# SMB Commerce OS — Working Rules for Claude

This file is read at the start of every session in this repo. It exists to keep sessions focused and to make the build delegable across gaps.

## Context boundary — read this first

This repo is the **build**. It is not the business-planning knowledge base. Do not read, reference, or act on anything outside `docs/design/` and this file unless the human operator explicitly asks for it in the current message.

Specifically **out of bounds by default**: fundraising plans, IP/liability structuring, sales/marketing plans, the token/valuation/GUSD concept material, or any file under `personal/Knowledge/Delusional_Reality/`. That material is reference-only context about *why* this product exists; it is never a build requirement, and past sessions have wasted effort chasing it. If a task seems to require it, stop and ask rather than pulling it in.

## What to read, every session, in order

1. This file.
2. `docs/BUILD_STATE.md` — current phase, current card ID, status, carried-over notes from the last session.
3. `docs/cards/{DAY_ID}.md` — the one card that's current. It is self-contained: task, deliverable, acceptance criteria, security check, and the exact prompt for that unit of work.
4. Only if the card references it: the **one** design doc in `docs/design/` it belongs to (see the phase table in `01_phasing_and_mvp_definition.md`). Do not re-read all 14 design docs each session — that is exactly the context bloat this file exists to prevent.

## Calendar, cards, and logs — the three-file convention

- **`docs/BUILD_CALENDAR.md`** — the master sequence, one row per Day ID (`D001`–`D176`), linking to that day's card and log. Day ID is the source of truth for sequence; there are no fixed calendar dates (see "Token-maxing execution" below).
- **`docs/cards/{DAY_ID}.md`** — the plan/prompt for that day, generated once from the phase plan and not rewritten. Read-only during execution.
- **`docs/logs/{DAY_ID}.md`** — written *after* the card runs, from `docs/logs/TEMPLATE.md`. Records what happened, the acceptance-criteria check, the security-check answer, commit hash(es), and outcome (Done / Carried / Blocked). Every log links back to its card and to `BUILD_CALENDAR.md`.

At the end of every card: write the log, update that row's Status in `BUILD_CALENDAR.md`, and update `BUILD_STATE.md`'s "current card" pointer to the next unblocked Day ID. A card is **Done** only if its acceptance criteria actually passed — otherwise it is **Carried**, with the reason in the log, and stays the current card next run.

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
