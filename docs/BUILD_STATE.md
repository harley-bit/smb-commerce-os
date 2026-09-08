# Build State

**Last updated:** 2026-09-07 (D001 done)
**Execution model:** token-maxing — sessions run back-to-back until the account's usage limit is hit, then resume automatically once it refreshes (see `docs/design/12_daily_build_protocol.md` and the "Token-maxing execution" note in `CLAUDE.md`). Elapsed calendar time is therefore driven by usage-limit cadence, not a fixed days-per-week number. **Day ID is the only reliable sequence marker — do not infer progress from dates.**
**Projected MVP gate (G7):** provisional only until real throughput is observed over the first ~10 cards. See `docs/BUILD_CALENDAR.md` for the full sequence.
**Per-card duration estimates:** every row in `docs/BUILD_CALENDAR.md`, the xlsx dashboard, and each `docs/cards/{DAY_ID}.md` now carries an "Est. Duration" figure — a heuristic planning estimate (by phase, weighted up for concurrency/deposit/payment/gate-review complexity) for an AI-assisted session, not a human day and not a commitment. Sum across all 176 cards is ~473.5 hours. **Treat this the same as the projected MVP gate date: recalibrate against real `docs/logs/` actual-effort data once cards start closing, don't defend the original number.**

## Current phase

**Phase 0 — Foundations and security baseline** (`D001`–`D012`). Underway — D001 done, pnpm workspace + Turborepo scaffolding is live.

## Current card

**Next up: [`D002`](../docs/cards/D002.md) — TypeScript strict configuration.**
Full task, deliverable, acceptance criteria, and security check are in the card file itself — that file, not this one, is the source of truth for what D002 actually requires. This file only tracks *where we are*, not *what to do*.

## Open decisions (blocking, from `docs/design/00_README.md`)

| # | Decision | Status |
|---|---|---|
| D1 | Ratify ADR-001 stack recommendation | **Answered — accepted as proposed.** TypeScript everywhere: Fastify, Drizzle, Next.js, Expo, pnpm monorepo. `docs/design/02_ADR_001_stack_decision.md`'s ratification table can be marked Accepted. |
| D2 | Confirm build cadence (drives every date) | **Answered** — 5–6 sessions/week, Claude as builder. |
| D3 | Mobile in MVP or post-pilot | **Answered — deferred to Phase 8**, post-web-MVP (G7). Matches the phase plan as written; revisit once the web pilot is live. |
| D4 | Identity provider | **Answered — native for now, Auth0 later.** Build authentication in-house behind an `AuthProvider` interface; wire in Auth0 when it's actually time, as a provider swap, not a rewrite. Full spec: [`docs/adr/ADR-002-authentication-provider.md`](adr/ADR-002-authentication-provider.md). This is a real scope change to D010 (was an OIDC/Cognito spike, now a native auth implementation) — `docs/cards/D010.md` has been rewritten accordingly. |

**No decisions remain blocking.** D001 is ready to run.

## Carried-over notes for next session

- `docs/implementation_calendar/build_calendar.xlsx` — human-facing dashboard, hyperlinked to `docs/cards/{DAY_ID}.md` / `docs/logs/{DAY_ID}.md`. Run `python3 scripts/sync_calendar_xlsx.py` after closing out a card to push Status/Notes without touching its hyperlinks — **not yet run for D001, do this at the start of the D002 session** (or now, if resuming this one).
- `pnpm` (12.3.4, via the system's node/corepack toolchain) and `turbo` are working; `pnpm-workspace.yaml` has an `allowBuilds: { esbuild: true }` entry approving vitest's transitive esbuild postinstall script — expect similar prompts (`pnpm approve-builds`) for other future transitive deps with install scripts.
- Root scaffolding uses scope `@smb-os/*` for internal packages (`@smb-os/domain`, `@smb-os/db`, `@smb-os/contracts`, `@smb-os/config`, `@smb-os/api`, `@smb-os/web`) — no prior convention existed, this is the one now in use.
- `lint`, `test`, and `test:isolation` are stub `echo` scripts in every package except `packages/domain` (real Vitest). D003 (lint/format) and D004 (test harness) are what actually wire these up — don't mistake the current green gate for those cards already being done.

## Log of completed cards

- [D001](logs/D001.md) — Initialize monorepo. pnpm workspaces + Turborepo, `apps/{api,web}` + `packages/{domain,db,contracts,config}` per ADR-001, real internal dependency graph, `packages/domain` has its first Vitest test. Done.
