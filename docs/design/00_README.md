# SMB Commerce OS — Technical Development Plan

**Plan date:** September 7, 2026
**Status:** ADR-001 ratified, D1/D3/D4 resolved (see `docs/BUILD_STATE.md` for current status — that file, not this one, is authoritative on what's actually decided and where the build currently stands). Phase 0 has not yet started executing cards.
**Objective:** a security-first, buildable path from empty repository to a pilot-ready MVP, expressed as dated daily work.

## What this program is

A build plan for the SMB Commerce OS platform: one catalog spanning **products** (sold outright), **services** (booked against provider time), and **rentals** (assets booked over a date range, returned, and inspected), with inventory shared across all three.

The business context — market, pricing, geography, monetization — lives elsewhere in the parent folder and is **reference only**. Nothing in it is a build requirement. This program is scoped to what gets engineered.

## Design constraints (fixed)

| Constraint       | Decision                                                                         |
| ---------------- | -------------------------------------------------------------------------------- |
| Database, local  | **SQLite** — WAL mode, single-writer serialization                               |
| Database, target | **AWS-hosted PostgreSQL** — schema written for portability from day one (`04`)   |
| Codebase         | Web and mobile — resolved in ADR-001 (`02`)                                      |
| Security         | **Security-first**, not retrofitted. Controls designed before features (`07`)    |
| Compliance       | Documentation produced as a by-product of the build, not a later exercise (`09`) |
| Cadence          | Daily buildable increments (`12`), weekly review (`13`)                          |

## Documents

**Strategy and decisions**

1. `01_phasing_and_mvp_definition.md` — phases, gates, and what MVP does and does not include
2. `02_ADR_001_stack_decision.md` — the web and mobile codebase decision, with recommendation

**Architecture** 3. `03_domain_model_and_schema.md` — the unified three-mode model and full table design 4. `04_database_portability_sqlite_to_aws.md` — SQLite now, PostgreSQL later, without a rewrite 5. `05_availability_inventory_and_concurrency.md` — the correctness core: no double-booking, no overselling 6. `06_api_contracts_and_service_boundaries.md` — API surface and internal boundaries

**Security, privacy, compliance** 7. `07_security_architecture_and_threat_model.md` — controls and STRIDE analysis 8. `08_privacy_data_protection_and_retention.md` — data classification, retention, subject rights 9. `09_compliance_control_mapping_and_evidence.md` — PCI, SOC 2, NIST CSF, state privacy; evidence-by-design 10. `10_secure_sdlc_ci_and_quality_gates.md` — pipeline, scanning, branch protection, test strategy

**Execution** 11. `11_environments_and_aws_target_architecture.md` — local, staging, production 12. `12_daily_build_protocol.md` — the repeatable daily loop 13. `13_weekly_review_protocol.md` — the weekly review agenda and template 14. `implementation_calendar/build_calendar.xlsx` — dated day-by-day plan, weekly review log, phase summary (see `../implementation_calendar/build_calendar.xlsx` — human-facing dashboard; `../BUILD_CALENDAR.md` is the version Claude reads/writes)

**Reference (superseded in parts, kept for its diagrams)** 15. `15_legacy_application_flow_diagrams.md` — pre-technical-plan flow sketches, moved here from the business-planning folder; read its banner before using anything but the diagrams themselves

**New scope (added 2026-09-08)** 16. `16_platform_admin_console.md` — platform-staff/power-user UI and workflow: break-glass support access, merchant lifecycle, reporting, feature flags, platform role management. Placed as Phase 11 (`D177`–`D197`), after `10` so it doesn't renumber any built card. Amends `03` and `07`.

## How to use this

1. **Ratify ADR-001** (`02`). Nothing can be built until the stack is fixed. This is the only blocking decision.
2. **Set the calendar** — open `build_calendar.xlsx`, set the start date and build days per week on the Config sheet. Every date recalculates.
3. **Run the daily loop** (`12`). One card per day, with acceptance criteria and a security check. Update the row.
4. **Run the weekly review** (`13`). Velocity, gates, security findings, scope changes.

## Blocking decisions — all resolved (see `docs/BUILD_STATE.md` for the live record)

| #   | Decision                            | Resolution                                                                                                                                         |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Ratify ADR-001 stack recommendation | **Accepted as proposed** (2026-09-07)                                                                                                              |
| D2  | Confirm build cadence               | **Claude executes continuously (token-maxing)**, not a fixed days/week human cadence                                                               |
| D3  | Mobile in MVP or post-pilot         | **Deferred to Phase 8**, post-web-MVP                                                                                                              |
| D4  | Identity provider                   | **Native auth now, Auth0-ready interface, Auth0 wired in later** — see `docs/adr/ADR-002-authentication-provider.md`, which also rewrote card D010 |

## Principles

**Correctness before surface.** The availability engine and the deposit state machine are the two places where a defect is visible to a customer and expensive to fix. They get built early and are covered by invariant tests, not smoke tests.

**Security controls precede the features they protect.** Tenant isolation, authorization, and audit logging are Phase 0 and Phase 1 work, not hardening at the end. Retrofitting a tenancy model is a rewrite.

**Compliance evidence is a build artifact.** Every control in `09` maps to something the pipeline or the repository already produces. No separate documentation project.

**One day, one verifiable increment.** If a card cannot be finished and verified in a day, it is too big and gets split before it starts.
