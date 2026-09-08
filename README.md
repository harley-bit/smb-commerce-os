# SMB Commerce OS

A unified catalog platform for small merchants selling products, booking services, and renting equipment — one inventory, one checkout, one dashboard.

**Status:** Phase 0 (foundations and security baseline). No application code yet.

## Start here

- `CLAUDE.md` — working rules and context boundaries for AI-assisted sessions on this repo.
- `docs/BUILD_STATE.md` — current phase, current card, open decisions, and the log of completed work. Read this before doing anything else.
- `docs/design/` — the full technical design: phasing, stack ADR, domain model, concurrency design, security architecture, compliance mapping, and the build/review protocols.

## Business context

This repo is the build only. The market, pricing, and go-to-market plan live in a separate planning folder and are not required to work on this codebase.


# To monitor from Terminal
launchctl print gui/$(id -u)/com.smbcos.buildloop   # status
launchctl bootout gui/$(id -u)/com.smbcos.buildloop # stop the schedule entirely
