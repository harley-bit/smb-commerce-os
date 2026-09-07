# Phasing and MVP Definition

## What the MVP is

A merchant can run a three-mode business end to end without engineering help:

- List **products** with variants and stock, and sell them.
- List **services** with duration and provider availability, and take bookings.
- List **rental assets** with rates and deposits, take reservations, hand them over, take them back, and settle the deposit.
- See all three in one dashboard, where **a unit out on rental cannot be sold**.

A customer can find the merchant's page, transact in any mode, and pay.

## What the MVP is not

Not in scope, and not to be built without a written scope change:

- Marketplace search across merchants, matching, ratings, or reviews
- Shipping and logistics integration (pickup and local delivery only)
- Rental asset classes beyond equipment and general goods — accommodation, vehicles, and watercraft each require a compliance module first
- Multi-currency at runtime (the schema supports it; the UI does not expose it)
- Offline mode, POS hardware, or barcode scanning
- Any valuation, token, or lending capability

## Phases

| # | Phase | Days | Gate |
|---:|---|---:|---|
| 0 | Foundations and security baseline | 12 | **G0** — repo, CI, and security gates green on an empty app |
| 1 | Domain model and database | 18 | **G1** — schema migrates, tenant isolation proven by test |
| 2 | Catalog and product inventory | 14 | **G2** — a product can be listed, stocked, and sold |
| 3 | Availability engine and services | 18 | **G3** — no double-booking under concurrent load |
| 4 | Rentals, deposits, and returns | 24 | **G4** — full rental lifecycle including deposit settlement |
| 5 | Payments — Stripe Connect | 14 | **G5** — money moves correctly in all three modes |
| 6 | Merchant dashboard (web) | 20 | **G6** — a merchant can operate unaided |
| 7 | Customer storefront (web) | 16 | **G7 — MVP GATE.** Pilot-capable, web only |
| 8 | Mobile application | 16 | **G8** — parity for customer flows on iOS and Android |
| 9 | Security hardening and compliance pack | 14 | **G9** — pen test clean, compliance evidence assembled |
| 10 | Pilot readiness and launch | 10 | **G10** — first merchant live |
| | **Total** | **176** | |

## Timeline

Dates are driven by the Config sheet in `implementation_calendar/build_calendar.xlsx`.

| Build days per week | Elapsed to MVP gate (D138) | Elapsed to full (D176) |
|---|---|---|
| 5 (full time) | ~28 weeks | ~35 weeks |
| 3 (part time) | ~46 weeks | ~59 weeks |
| 2 | ~69 weeks | ~88 weeks |

**Read the part-time row honestly.** At three build days a week, the MVP gate is roughly eleven months out. That is the realistic planning number for a founder splitting time, and it is the strongest argument for adding engineering capacity rather than extending the calendar.

## Phase detail

**Phase 0 — Foundations and security baseline (12 days).** Monorepo, toolchain, linting, type checking, test harness, CI pipeline with secret scanning, dependency scanning, and SAST wired before any application code exists. Identity provider selected and integrated. Base security headers and logging. Threat model reviewed. *Nothing ships in this phase; the point is that every later day inherits working gates.*

**Phase 1 — Domain model and database (18 days).** Full schema per `03`, migrations, seed data, repository layer with enforced tenant scoping, audit log with hash chaining, and the cross-tenant access test suite. Money as integer minor units; time as UTC throughout. *Gate G1 requires a passing test that proves merchant A cannot read merchant B's data through any repository method.*

**Phase 2 — Catalog and product inventory (14 days).** Listings with mode discriminator, variants, inventory units (fungible and serialized), stock movements, and the product sale path. The shared-inventory invariant is introduced here even though rentals do not exist yet.

**Phase 3 — Availability engine and services (18 days).** Resources, availability rules and exceptions, the interval reservation model, conflict detection, and service booking. *Gate G3 requires a concurrency test that fires simultaneous bookings at the last slot and proves exactly one succeeds.*

**Phase 4 — Rentals, deposits, and returns (24 days).** The largest phase, and the differentiating one. Rental listings, per-unit reservation, checkout and check-in events, condition reports with media, the deposit state machine, damage claims, late-return handling and downstream conflict alerts.

**Phase 5 — Payments (14 days).** Stripe Connect onboarding, split payments, authorization holds with capture and release, refunds per mode, and webhook handling with idempotency. *Card data never touches our servers — hosted fields only.*

**Phase 6 — Merchant dashboard (20 days).** Onboarding, catalog management across all three modes, the unified calendar and order view, inventory with rental status visible, deposit and claim handling, and settings.

**Phase 7 — Customer storefront (16 days).** Public merchant page with mixed catalog, product purchase, service booking, rental reservation with deposit consent, and order history. **This is the MVP gate — the platform is pilot-capable at the end of this phase, web only.**

**Phase 8 — Mobile application (16 days).** Customer flows on iOS and Android from the shared codebase. *Candidate for deferral until after the pilot — see decision D3.*

**Phase 9 — Security hardening and compliance pack (14 days).** Penetration test and remediation, load testing on the availability engine, PCI SAQ A completion, policy set finalized, control evidence assembled per `09`.

**Phase 10 — Pilot readiness (10 days).** Runbooks, backup and restore rehearsal, monitoring and alerting, merchant onboarding materials, and the first live merchant.

## Gate rule

A gate is passed when its acceptance test passes in CI, not when the calendar reaches it. A failed gate stops the next phase. The two gates that must never be waived are **G1** (tenant isolation) and **G3** (no double-booking) — both are correctness properties that become extremely expensive to retrofit once data exists.

## Scope change rule

Any addition to MVP scope requires a written change note recording what it costs in days and which phase absorbs it. The plan has no slack built in; additions extend the end date rather than compressing existing work.
