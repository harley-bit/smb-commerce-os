# Build State

**Last updated:** 2026-09-07 (repo bootstrap + calendar generated)
**Execution model:** token-maxing — sessions run back-to-back until the account's usage limit is hit, then resume automatically once it refreshes (see `docs/design/12_daily_build_protocol.md` and the "Token-maxing execution" note in `CLAUDE.md`). Elapsed calendar time is therefore driven by usage-limit cadence, not a fixed days-per-week number. **Day ID is the only reliable sequence marker — do not infer progress from dates.**
**Projected MVP gate (G7):** provisional only until real throughput is observed over the first ~10 cards. See `docs/BUILD_CALENDAR.md` for the full sequence.
**Per-card duration estimates:** every row in `docs/BUILD_CALENDAR.md`, the xlsx dashboard, and each `docs/cards/{DAY_ID}.md` now carries an "Est. Duration" figure — a heuristic planning estimate (by phase, weighted up for concurrency/deposit/payment/gate-review complexity) for an AI-assisted session, not a human day and not a commitment. Sum across all 176 cards is ~473.5 hours. **Treat this the same as the projected MVP gate date: recalibrate against real `docs/logs/` actual-effort data once cards start closing, don't defend the original number.**

## Current phase

**Phase 0 — Foundations and security baseline** (`D001`–`D012`). Not yet started — this session bootstrapped the repo shell and generated the full calendar/card/log scaffolding. No application code, no toolchain config yet.

## Current card

**Next up: [`D001`](../docs/cards/D001.md) — Initialize monorepo.**
Full task, deliverable, acceptance criteria, and security check are in the card file itself — that file, not this one, is the source of truth for what D001 actually requires. This file only tracks *where we are*, not *what to do*.

## Open decisions (blocking, from `docs/design/00_README.md`)

| # | Decision | Status |
|---|---|---|
| D1 | Ratify ADR-001 stack recommendation | **Answered — accepted as proposed.** TypeScript everywhere: Fastify, Drizzle, Next.js, Expo, pnpm monorepo. `docs/design/02_ADR_001_stack_decision.md`'s ratification table can be marked Accepted. |
| D2 | Confirm build cadence (drives every date) | **Answered** — 5–6 sessions/week, Claude as builder. |
| D3 | Mobile in MVP or post-pilot | **Answered — deferred to Phase 8**, post-web-MVP (G7). Matches the phase plan as written; revisit once the web pilot is live. |
| D4 | Identity provider | **Answered — native for now, Auth0 later.** Build authentication in-house behind an `AuthProvider` interface; wire in Auth0 when it's actually time, as a provider swap, not a rewrite. Full spec: [`docs/adr/ADR-002-authentication-provider.md`](adr/ADR-002-authentication-provider.md). This is a real scope change to D010 (was an OIDC/Cognito spike, now a native auth implementation) — `docs/cards/D010.md` has been rewritten accordingly. |

**No decisions remain blocking.** D001 is ready to run.

## Carried-over notes for next session

- Repo created at `/Users/harleybarrales/Documents/Git Code Base/smb-commerce-os`, git initialized, first commit in.
- Design docs copied into `docs/design/` — authoritative for this repo; the original in `personal/Knowledge/Delusional_Reality/business_ideas/smb_commerce_os/technical_development_plan/` is historical/planning context only.
- `docs/BUILD_CALENDAR.md` generated from the original `build_calendar.xlsx` Daily Plan sheet (176 rows) — same tasks, deliverables, acceptance criteria, and security checks the coworker's plan already defined, just restructured as one linked file per day instead of spreadsheet rows.
- `docs/cards/D001.md` … `D176.md` generated, one per day, each self-contained with the exact prompt to run that card.
- `docs/logs/` created empty except `TEMPLATE.md` — the first real file lands as `docs/logs/D001.md` once D001 is actually run.
- `docs/implementation_calendar/build_calendar.xlsx` — the original coworker-plan spreadsheet, copied into this repo with real hyperlink columns added (`M` Card, `N` Log) pointing at `docs/cards/{DAY_ID}.md` and `docs/logs/{DAY_ID}.md`. This is the human-facing dashboard; `docs/BUILD_CALENDAR.md` stays the source of truth I read/write. Run `python3 scripts/sync_calendar_xlsx.py` after closing out a card to push Status/Notes into the spreadsheet without touching its hyperlinks.
- `pnpm` not yet installed on this machine — corepack is available (`corepack enable`); first real session should use `corepack pnpm` rather than a global npm install.
- D1 and D4 should be resolved before D001 starts — D4 specifically because Phase 0 includes identity-provider integration.

## Log of completed cards

*(empty — first entry lands when D001 is done; each entry here is one line linking to that day's full log)*
