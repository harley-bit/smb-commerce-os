# Secure SDLC, CI, and Quality Gates

## Principle

The pipeline is built in Phase 0, **before any application code exists**. Every day thereafter inherits working gates. A pipeline added later has to be retrofitted against a codebase that already violates it, and the usual outcome is that the rules get relaxed to make the build pass.

## Branching

Trunk-based. `main` is always releasable. Short-lived branches, small pull requests, merged within a day or two.

Branch protection on `main`: no direct pushes, all status checks pass, at least one approving review (see below), branch current before merge, signed commits, linear history.

**The solo-developer problem.** With one developer there is nobody to review. Do not disable the requirement — that removes the audit trail that evidences CC8 change management. Instead: pull requests still open and still run every check, self-merge is permitted with a required completed self-review checklist recorded in the PR, and any second contributor immediately restores real review. The record of what was checked survives either way.

## Pipeline

Every pull request:

| Stage | Check | Fails build on |
|---|---|---|
| 1 | Install with a frozen lockfile | Lockfile drift |
| 2 | Lint (ESLint) and format (Prettier) | Any error |
| 3 | Type check (`tsc --noEmit`, strict) | Any error |
| 4 | **Secret scan (gitleaks)** | Any finding |
| 5 | **Dependency scan** | Any high or critical with a fix available |
| 6 | **SAST (CodeQL or Semgrep)** | Any high or critical |
| 7 | Unit tests | Any failure, or coverage below threshold |
| 8 | **Migrations against SQLite and PostgreSQL** | Either dialect fails |
| 9 | Integration tests, both dialects | Any failure |
| 10 | **Tenant isolation suite** | Any failure — never waivable |
| 11 | **Concurrency invariant suite** | Any failure — never waivable |
| 12 | Contract check — routes match published schemas | Divergence |
| 13 | Build web, mobile, and API | Any failure |
| 14 | SBOM generation, retained as an artifact | — |

On merge to `main`: the above, plus end-to-end tests (Playwright), a container image scan, and deployment to staging.

**Stages 10 and 11 are never waivable.** Tenant isolation and reservation correctness are the two properties whose violation cannot be fixed after the fact — one is a breach, the other is corrupted data and angry customers.

## Pre-commit

Fast checks only, so the hook is never bypassed out of frustration: format staged files, lint staged files, secret scan, and a conventional-commit message check. Type checking and tests belong in CI, not in the hook.

## Test strategy

| Layer | Tool | Scope | Target |
|---|---|---|---|
| **Domain unit** | Vitest | `/packages/domain` — state machines, conflict detection, money arithmetic. No I/O | **95%+** |
| **Integration** | Vitest + real SQLite | Repositories and services against a real database | 80%+ |
| **Concurrency** | Vitest, real parallel transactions | The invariant suite (`05`) | Every listed case |
| **Tenant isolation** | Vitest, generated from repository interfaces | Every repository method | 100% of methods |
| **Contract** | Vitest + Zod | Request and response schemas | Every endpoint |
| **End-to-end** | Playwright | Critical paths only | The five flows below |
| **Load** | k6 | Availability endpoint, reservation creation | Phase 9 |

**Coverage thresholds are enforced but are not the goal.** The domain package carries the high bar because it holds the invariants and has no I/O to make testing awkward. Chasing a number in controller code produces tests that assert the code does what it does.

**The five end-to-end flows:** product purchase; service booking; rental reservation with deposit through to release; rental with a damage claim through to capture; and merchant onboarding to first listing. Everything else is covered at a lower layer, because end-to-end tests are slow and brittle and a large suite of them stops being run.

**Concurrency tests must actually be concurrent.** Real parallel transactions against a real database. A test that calls a function twice in sequence with a mocked clock proves nothing about a race.

## Definition of Done

A day's card is done when **all** of the following hold. Partial completion is not done, and a card carried to the next day is recorded as carried, not quietly extended.

- [ ] Acceptance criteria on the card are met
- [ ] Tests written **before or alongside** the code, not after
- [ ] All CI stages green
- [ ] No new high or critical findings from any scanner
- [ ] Any architectural decision recorded as an ADR
- [ ] Any new data field classified in `08`
- [ ] Any new endpoint has a contract schema and an authorization check
- [ ] Any new repository method has a tenant-isolation test
- [ ] Documentation updated where behaviour changed
- [ ] Calendar row updated: status, actual effort, notes

The last four are the ones that decay first under time pressure, which is why they are on the checklist rather than assumed.

## Security review triggers

A deeper review, recorded in `/docs/compliance/threat-model-reviews/`, is required when any of these occurs — not on a schedule:

- A new external integration or sub-processor
- A new data class, especially personal data
- A change to authentication or authorization
- A change touching payment flow or deposit state
- A new trust boundary
- Any change that could affect PCI SAQ A eligibility

## Dependency management

Pinned versions with a committed lockfile. Automated update pull requests, reviewed weekly during the weekly review (`13`). Security patches applied within seven days for critical, thirty for high. New dependencies require a justification note in the pull request — license, maintenance status, and whether the functionality is worth the supply-chain surface.

## Environments and release

Local (SQLite, synthetic data only) → staging (PostgreSQL, synthetic data, auto-deployed from `main`) → production (PostgreSQL, manual promotion). Detail in `11`.

**Production data never leaves production.** No production database copied to a laptop, no production dump in the repository. Enforced by a CI check that fails on data fixtures resembling real records.

Releases: automatic to staging on merge; manual promotion to production with a tagged release, a change log generated from conventional commits, and a documented rollback path. Migrations are forward-only — a bad migration is corrected by a new migration, never by a down migration in production.
