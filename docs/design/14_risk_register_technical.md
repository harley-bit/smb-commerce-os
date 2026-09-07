# Technical Risk Register

Reviewed weekly (`13`). Severity is impact × likelihood for the build specifically. Business and market risks are out of scope here.

## Critical

| # | Risk | Impact | Mitigation | Trigger to escalate |
|---|---|---|---|---|
| T1 | **Cross-tenant data leak** — a repository method or raw query without a merchant scope | Breach affecting every merchant at once; likely fatal to the venture | Four-layer isolation (`07`); `TenantContext` as a required first parameter so omission is a compile error; generated isolation suite covering every repository method; Gate G1 | Any isolation test skipped or failing |
| T2 | **Double-booking in production** — the availability engine allows overlap | Two customers arrive for one asset; the failure the platform exists to prevent | PostgreSQL exclusion constraint; SQLite `BEGIN IMMEDIATE`; real-parallel concurrency suite; Gate G3 | Any concurrency test skipped, or a production overlap observed |
| T3 | **Deposit state corruption** — a customer's money is held, captured, or released incorrectly | Chargebacks, disputes, and loss of merchant trust that is not recoverable | Deposit state machine in `/packages/domain`; single-capture enforcement; capture bounded by authorization; every transition audit-logged | Any deposit reconciliation mismatch |
| T4 | **SQLite-to-PostgreSQL portability failure discovered late** | Cutover becomes a rewrite under time pressure | P1–P10 rules (`04`); CI runs migrations and integration tests against both dialects every build | A portability rule waived, or the PostgreSQL CI job disabled |

## High

| # | Risk | Mitigation |
|---|---|---|
| T5 | **Scope creep inside the build** — features added mid-phase | MVP definition in `01` is explicit about exclusions; scope changes cost days and are recorded at the weekly review |
| T6 | **Cards consistently larger than one day** — the schedule silently becomes fiction | Actual effort recorded daily; rolling completion rate reviewed weekly; re-scope trigger at 50% overrun |
| T7 | **Solo-developer bus factor** — no review, no second pair of eyes, no continuity | Design documents are the continuity mechanism; ADRs record why; self-review checklist preserves the audit trail; all decisions in version control |
| T8 | **Late returns cascading into unrecognized double-bookings** | Overdue detection with downstream conflict alerts naming the affected booking (`05`); explicitly tested |
| T9 | **Webhook processing errors** — missed, duplicated, or out-of-order provider events | Signature verification, idempotency on provider event ID, raw event persistence, ordering tolerance |
| T10 | **Hold exhaustion** — an attacker or a bug reserves all inventory without paying | Short hold TTL; per-IP and per-account concurrent-hold caps, stricter for anonymous carts; abandonment monitoring |
| T11 | **Rental period exceeding the authorization window** — deposits cannot be held beyond ~30 days | Product constraint surfaced in the merchant UI at configuration time; captured deposit or contractual claims process for longer terms |
| T12 | **Condition media retention never implemented**, leaving an unbounded personal-data store | Retention job built in Phase 4 alongside the feature, not deferred; dry-run mode plus deletion audit records |

## Medium

| # | Risk | Mitigation |
|---|---|---|
| T13 | Availability endpoint abuse or cost | 90-day window cap; caching with invalidation; per-IP limits; WAF |
| T14 | Third-party analytics or error tracking capturing personal data | Field scrubbing configured before the first event is sent (`08`) |
| T15 | Dependency vulnerability in a transitive package | Automated scanning in CI; weekly update review; SBOM per build |
| T16 | Identity provider lock-in | OIDC standard flows only; no provider-specific claims in domain logic |
| T17 | Mobile app store review delays blocking a release | Web is the MVP surface (Gate G7); mobile is Phase 8 and deferrable |
| T18 | Test suite slowness eroding the daily loop | In-memory SQLite for unit and integration; end-to-end limited to five flows |
| T19 | Documentation drift — designs no longer describe the system | Monthly drift check in the weekly review addendum |
| T20 | Alert fatigue with no on-call rotation | Alerts tuned to genuine customer impact only (`11`) |

## Low

| # | Risk | Mitigation |
|---|---|---|
| T21 | AWS cost overrun | Conservative sizing; monthly cost review; billing alarms |
| T22 | Fungible-versus-serialized modelling proving wrong for some merchant | Rentals are always serialized (`05`); revisit only with evidence from a real merchant |
| T23 | Timezone handling errors around daylight saving | UTC storage throughout; IANA zone on location; DST transition cases in the availability test suite |

## Risks explicitly accepted

Recorded so that they are decisions rather than oversights:

| Risk | Why accepted |
|---|---|
| No high availability during the pilot | Single-region, Multi-AZ RDS is sufficient. Multi-region complexity is unjustified at pilot scale |
| No offline capability | Merchants have connectivity. Offline sync would roughly double the client complexity |
| Coarse-grained RBAC — five roles, no per-object permissions | Sufficient for small merchants; finer permissions add complexity nobody has asked for |
| One API service, no decomposition | A single service is easier to reason about and secure; split on measured need |
| SQLite development databases unencrypted | Synthetic data only, enforced by a CI check |

## Retired risks

*(Record here as risks are closed, with the date and the reason. An empty section at the start of a project is expected; one that is still empty in month six means the register is not being maintained.)*
