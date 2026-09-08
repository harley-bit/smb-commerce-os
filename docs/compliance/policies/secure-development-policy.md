# Secure Development Policy

**Effective date:** 2026-09-08
**Version:** 1.0
**Owner:** Founder / Head of Engineering
**Applies to:** All code, configuration, and infrastructure-as-code contributed to `smb-commerce-os`.
**Revision history:** Version-controlled; changes ship as pull requests against `main`, and the git log for this path is the record of how the development process has evolved.

## Purpose

States the rules code must satisfy before it reaches `main`, so that security is enforced by the pipeline on every change rather than relied on as a discipline. The full pipeline design and its Definition of Done live in `docs/design/10_secure_sdlc_ci_and_quality_gates.md` — this policy is the governance commitment to running it on every change, unmodified, without exception.

## Principles

- **The pipeline exists before application code does.** Every day's work inherits working gates rather than having them retrofitted later, when relaxing a rule to make a build pass becomes the path of least resistance.
- **Tests are written before or alongside code**, not after — non-negotiable for `packages/domain`, reservations, inventory, money, and authorization code (`CLAUDE.md`).
- **No gate is skippable to keep a deadline.** Tenant isolation (G1) and no-double-booking under concurrency (G3) are never waived, skipped, or deferred.

## Required checks on every pull request

Enforced by `.github/workflows/ci.yml` and, for the fast subset, by local git hooks (`.githooks/`):

| Stage | Check | Fails build on |
|---|---|---|
| Install | Frozen lockfile | Lockfile drift |
| Lint / format | ESLint + Prettier, including a custom rule banning raw SQL outside `packages/db` | Any error |
| Type check | `tsc --noEmit`, strict mode | Any error |
| Secret scan | gitleaks (pre-commit hook and CI, full history) | Any finding |
| Dependency scan | `pnpm audit --audit-level=high`, plus a syft SBOM retained as a CI artifact | Any high/critical with a fix available |
| SAST | semgrep, `p/security-audit` ruleset | Any high/critical finding |
| Unit tests | Vitest, with coverage thresholds where set | Any failure or threshold miss |
| Pre-push | `pnpm audit` + semgrep, locally, before anything leaves the machine | Same as above, closer to the source |

Later phases add: dual-dialect migration checks, integration tests, the tenant-isolation suite, the concurrency invariant suite, contract checks, and multi-target builds — all with the same "never waivable for G1/G3" rule.

## Branching and review

Trunk-based, short-lived branches, `main` always releasable. Branch protection on `main` requires status checks to pass and a pull request (no direct push) — see `docs/design/17_change_management_policy.md` for the exact settings and the solo-maintainer self-merge accommodation (`required_approving_review_count: 0`, not disabled review — the PR and its checklist are still the audit trail).

## Commit and PR discipline

- Commit messages follow Conventional Commits, enforced by a `commit-msg` git hook.
- Every PR completes the self-review checklist in `.github/pull_request_template.md`, which is itself the CC8 change-management evidence.
- Every day's card carries its Day ID in the commit message, tying code changes back to the build log and calendar record.

## Definition of Done

A change is done only when all of the following hold (full list in `10`): acceptance criteria met; tests written before/alongside code; all CI stages green; no new high/critical scanner findings; any architectural decision recorded as an ADR; any new data field classified (`08`); any new endpoint has a contract schema and an authorization check; any new repository method has a tenant-isolation test; documentation updated where behavior changed; calendar row updated with status and actual effort.

## Related policies

[Information Security Policy](information-security-policy.md) · [Access Control Policy](access-control-policy.md) · [Vendor Management Policy](vendor-management-policy.md)
