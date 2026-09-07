# SMB Commerce OS — Working Rules for Claude

This file is read at the start of every session in this repo. It exists to keep sessions focused and to make the build delegable across gaps.

## Context boundary — read this first

This repo is the **build**. It is not the business-planning knowledge base. Do not read, reference, or act on anything outside `docs/design/` and this file unless the human operator explicitly asks for it in the current message.

Specifically **out of bounds by default**: fundraising plans, IP/liability structuring, sales/marketing plans, the token/valuation/GUSD concept material, or any file under `personal/Knowledge/Delusional_Reality/`. That material is reference-only context about *why* this product exists; it is never a build requirement, and past sessions have wasted effort chasing it. If a task seems to require it, stop and ask rather than pulling it in.

## What to read, every session, in order

1. This file.
2. `docs/BUILD_STATE.md` — current phase, current card, status, carried-over notes from the last session.
3. The **one** design doc in `docs/design/` that the current card belongs to (see the phase table in `01_phasing_and_mvp_definition.md`). Do not re-read all 14 design docs each session — that is exactly the context bloat this file exists to prevent.
4. The card definition itself, from `docs/cards/`.

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
