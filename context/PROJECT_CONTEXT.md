# SMB Commerce OS (code repo) — Project Context Snapshot

**Snapshot date:** 2026-09-08 (updated — build execution underway, automated loop added, Phase 11 scoped)
**Purpose of this file:** re-orient quickly on this repo's current state without re-reading every design doc, card, and commit. For the live, authoritative build status, always defer to `docs/BUILD_STATE.md` — this file is a slower-moving overview, that one is the source of truth on exactly where execution stands right now.

---

## What this repo is

The **engineering build** for SMB Commerce OS: a unified catalog platform where a merchant lists **products** (sold outright), **services** (booked against provider time), and **rentals** (assets booked over a date range, checked out, returned, and inspected) — all sharing one inventory, one order/checkout flow, and one dashboard. The defining invariant no comparable platform implements: a unit currently out on rental cannot be sold.

This repo is deliberately separated from the business-planning material, which lives in `personal/Knowledge/Delusional_Reality/business_ideas/smb_commerce_os/` (market research, business plan, GTM, fundraising, IP/legal). `CLAUDE.md`'s context boundary means sessions in this repo don't read that folder unless explicitly asked — that separation is the fix for an earlier failure mode in this project ("wasted my tokens on a wild goose chase" chasing business-vision tangents instead of building).

## Who builds this, and how

**Claude is the developer**, not a contracted team or a low-code partner (the original business plan assumed the latter — superseded). Execution model is **token-maxing**: run cards back-to-back until the session's usage limit is hit, resume from `docs/BUILD_STATE.md` on the next run, repeat until done. See `CLAUDE.md`'s "Operating model — WHO/WHAT/WHEN/WHERE/HOW" section for the full statement of this.

**WHERE** is enforced practically: `.claude/settings.json` pre-approves ordinary build/test/git operations scoped to this repo directory (pnpm/npm/node, local git read/write, file Edit/Write/Read under this path) so the loop doesn't stall on interactive approval — with an explicit deny list for anything remote, destructive, or privilege-escalating (git push/pull/fetch/remote, reset --hard, clean, rebase, branch delete, sudo, broad rm -rf). This is a scoped allowlist, not a permissions bypass.

## Scope — full, no cuts, plus one addition

Products + services + rentals, single unified catalog, single vertical/geography assumption inherited from the business plan (local service SMEs, not yet re-confirmed against the rentals-inclusive technical scope). Mobile is Phase 8, after the web MVP gate (G7) — deferred by decision, doesn't block G7. No discovery/marketplace search, ratings/reviews, valuation engine, or token/CRM layer in this build — see `docs/design/01_phasing_and_mvp_definition.md` for the full in/out table.

**Phase 11 — Platform admin console (added 2026-09-08).** The original coworker plan never scoped a platform-staff/power-user surface — `07`'s `PLATFORM_ADMIN` role existed on paper with no UI behind it. Founder requested it be scoped as a **full internal ops console**, not just read-only support tooling: tiered platform roles (`PLATFORM_SUPPORT` < `PLATFORM_ADMIN` < `PLATFORM_SUPERADMIN`, a separate axis from merchant roles), a separate `apps/admin` app (blast-radius isolation + network restriction, not a route inside the merchant dashboard), break-glass merchant access (reason-required, time-boxed grants, no standing access ever), support actions, merchant lifecycle management, platform-wide reporting, feature flags, and platform staff role management. Full design: `docs/design/16_platform_admin_console.md`. Placed as `D177`–`D197` (Gate G11) **after** Phase 10 specifically so it didn't renumber any already-built card. Total build now 197 cards, not 176.

## The four blocking decisions — all resolved

| # | Decision | Resolution | Where recorded |
|---|---|---|---|
| D1 | Stack (ADR-001) | **Accepted as proposed** — TypeScript everywhere: Fastify API, Drizzle ORM, Next.js web, Expo mobile, pnpm monorepo | `docs/design/02_ADR_001_stack_decision.md` (ratification table) |
| D2 | Build cadence | **Claude executes continuously (token-maxing)**, not a human days/week number | `CLAUDE.md`, `docs/BUILD_STATE.md` |
| D3 | Mobile timing | **Deferred to Phase 8**, post-web-MVP | `docs/BUILD_STATE.md` |
| D4 | Identity provider | **Native auth now, Auth0-ready interface, Auth0 wired in later** — a real scope change from the original "delegate to managed IdP" plan | `docs/adr/ADR-002-authentication-provider.md` |

D4 had a real consequence: card D010 was rewritten from an OIDC/Cognito spike into a native `AuthProvider` implementation (Argon2id hashing, session table, rate limiting — materially more work than the original spike), and `docs/design/07`'s Authentication section was marked superseded-in-part with a pointer to ADR-002.

## Database posture

**SQLite first, AWS PostgreSQL later — not AWS from day one.** Reasoning (see `docs/design/04`): SQLite's single-writer serialization gives free atomicity for the no-double-booking guarantee; the portability rules mean the later cutover is a tested mechanical step, not a rewrite risk; and AWS's ~$250–350/month steady-state cost buys nothing at zero users. Recommendation given: open the AWS account and do IAM/billing setup now (free, ~15 min) but provision no paid resources until the cutover trigger (real concurrent merchants, need for managed backups) is actually hit.

## The calendar / card / log system

Three files work together for every unit of work, plus a human dashboard:

- **`docs/BUILD_CALENDAR.md`** — the 176-row master sequence (Day ID, phase, epic, task, gate, **estimated duration**, status, links to card + log). This is what Claude reads/writes each session. Day ID is the sequence key — there is no fixed calendar date under token-maxing.
- **`docs/cards/D001.md` … `D176.md`** — one fully-written prompt/plan per day, self-contained (task, deliverable, acceptance criteria, security check, estimated duration, exact execution prompt). All 176 already exist — nothing left to generate.
- **`docs/logs/{DAY_ID}.md`** — written after a card actually runs, from `docs/logs/TEMPLATE.md`, linking back to its card and calendar row.
- **`docs/implementation_calendar/build_calendar.xlsx`** — human-facing dashboard mirroring the same 176 rows, with real clickable hyperlinks (columns M/N) to each card and log file. Kept in sync via `scripts/sync_calendar_xlsx.py` (pushes Status/Notes/Duration from the markdown calendar — never hand-edit the xlsx's Status column, it'll be overwritten).

**Per-card duration estimates** are a heuristic (base hours per phase, weighted up for concurrency/deposit/payment/gate-review complexity) — an AI-assisted-session planning figure, not a human-day estimate or a commitment. Sum across all 197 cards: ~519 hours (~473.5h original + ~45.5h for Phase 11). Same rule as the projected MVP gate date: recalibrate against real `docs/logs/` actual-effort data once cards start closing, don't defend the original number.

## Execution is live — the build loop runs itself

This is no longer a "ready to run whenever" plan — it is actually executing, unattended, on a schedule:

- **`scripts/run_build_loop.py`** invokes `claude -p` on the current card, verifies `BUILD_STATE.md`'s current-card pointer actually advanced afterward, and stops cleanly (distinct exit codes) on a usage-limit signal, a stalled/Carried card, or an unclean working tree — it never guesses past a problem.
- **A macOS LaunchAgent** (`~/Library/LaunchAgents/com.smbcos.buildloop.plist`) fires this on a schedule (currently hourly), opening a visible Terminal window via `scripts/open_build_loop_terminal.sh` only when there's real work to do (lock + dry-run pre-check gates it). Each firing runs up to **6 cards** (`--max-cards 6`) before stopping, one fully closed out before the next starts. Manage it with `launchctl print/bootout/bootstrap gui/$(id -u)/com.smbcos.buildloop`; full docs in `scripts/BUILD_LOOP.md`.
- Two real headless-execution bugs were found and fixed getting this working: the workspace needed `hasTrustDialogAccepted: true` in `~/.claude.json` for `.claude/settings.json`'s allowlist to apply at all in non-interactive runs, and `-p` mode needed an explicit `--permission-mode auto` or it silently falls back to an interactive approval it can never get. `claude -p`'s output is also routed through `script -q` (pseudo-tty allocation) so it streams live instead of buffering until exit.

## Current status

**Phase 0 (Foundations and security baseline) is underway, running via the automated loop.** `D001`–`D003` are Done (monorepo init, strict TypeScript regression test, ESLint/Prettier + a custom raw-SQL-ban lint rule); `D004` (test harness — Vitest coverage thresholds) is in flight as of this snapshot. No blocking decisions remain. Don't trust a specific Day ID in this file as current for long — check `docs/BUILD_STATE.md` or run `python3 scripts/run_build_loop.py --dry-run`.

## Files and folders at a glance

| Path | What it is |
|---|---|
| `CLAUDE.md` | Working rules for every session: context boundary, calendar/card/log convention, token-maxing execution model, non-negotiable gates (tenant isolation, no double-booking) |
| `docs/BUILD_STATE.md` | The live tracker — current phase, current card, decision log, carried-over notes. **Read this first, every session.** |
| `docs/BUILD_CALENDAR.md` | The 197-day master sequence Claude reads/writes |
| `docs/cards/`, `docs/logs/` | Per-day prompts and per-day run logs |
| `docs/implementation_calendar/build_calendar.xlsx` | Human dashboard mirror with clickable links |
| `docs/design/00`–`14` | The original technical plan: phasing, ADR-001, domain model, portability, concurrency, API contracts, security/threat model, privacy, compliance mapping, CI/CD, environments, daily/weekly protocols, risk register |
| `docs/design/15_legacy_application_flow_diagrams.md` | Pre-technical-plan flow sketches, moved in from the business-planning folder; superseded in parts (see its banner) |
| `docs/design/16_platform_admin_console.md` | Phase 11 — platform admin/power-user console (added 2026-09-08) |
| `docs/adr/ADR-002-authentication-provider.md` | The native-auth-now, Auth0-later decision and its real security requirements |
| `.claude/settings.json` | Project-scoped permission allowlist for the build loop (`Edit(path)` rules only — `Write(path)` rules are silently ignored by permission checks) |
| `scripts/run_build_loop.py` | The automated driver — invokes `claude -p` per card, verifies real progress, stops cleanly on a problem |
| `scripts/open_build_loop_terminal.sh`, `~/Library/LaunchAgents/com.smbcos.buildloop.plist` | The scheduling layer — opens a visible Terminal window on an hourly timer, only when there's work to do |
| `scripts/BUILD_LOOP.md` | Full docs for the loop: exit codes, launchd management, the TCC/trust/permission-mode gotchas already solved |
| `scripts/sync_calendar_xlsx.py` | Pushes Status/Notes/Duration from the markdown calendar into the xlsx dashboard |

## What deliberately isn't in this repo

Business plan, market research, GTM/marketing plan, fundraising plan, IP/liability/personal-asset structuring, competitor analysis — all of that stays in `business_ideas/smb_commerce_os/` in the planning folder, on purpose. If a build session seems to need that material, that's a signal to stop and ask, not to go read it.
