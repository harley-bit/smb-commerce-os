# Information Security Policy

**Effective date:** 2026-09-08
**Version:** 1.0
**Owner:** Founder / Head of Engineering (sole engineering role at this stage)
**Applies to:** All systems, code, and data under `smb-commerce-os`, and anyone with commit or infrastructure access to them.
**Revision history:** This file is version-controlled. Every change is a pull request against `main`; the git log for this path is the authoritative revision history, and the PR that merged each change is the approval record. No separate change log is kept.

## Purpose

This policy states the organization's commitment to protecting merchant, customer, and payment-adjacent data, and names the framework and controls that commitment is built on. It exists so that "how do you handle security" has a written, dated, version-controlled answer rather than an ad hoc one.

## Framework

Controls are organized against **NIST CSF 2.0** (Govern, Identify, Protect, Detect, Respond, Recover) — chosen because it is free, comprehensive, and maps onward to SOC 2 and ISO 27001 without rework if either is pursued later. The full control-to-artifact mapping lives in `docs/design/09_compliance_control_mapping_and_evidence.md` and is kept current as controls land.

## Principle: evidence by design

Every control below maps to an artifact the repository or CI pipeline already produces as a normal by-product of building — a passing test, a CI gate result, a policy file in version control — not a document written once for an audit and never read again.

## Scope of the security program

- **Govern** — this policy set, the risk register (`docs/design/14_risk_register_technical.md`, reviewed weekly per `docs/design/13_weekly_review_protocol.md`), the RBAC role matrix, and change-management process (`docs/design/17_change_management_policy.md`).
- **Identify** — data classification (`docs/design/08_privacy_data_protection_and_retention.md`), the threat model (`docs/design/07_security_architecture_and_threat_model.md`), and a dependency/SBOM inventory generated on every build.
- **Protect** — tenant isolation, authentication and MFA, least-privilege authorization, encryption in transit and at rest, secrets management, and the secure development lifecycle. See the [Access Control Policy](access-control-policy.md) and [Secure Development Policy](secure-development-policy.md).
- **Detect** — audit logging with hash-chain verification, dependency and SAST scan results in CI, and (from Phase 9) security event alerting.
- **Respond and Recover** — see the [Incident Response Policy](incident-response-policy.md).

## Roles and responsibilities

At this stage the founder holds every engineering and security role. Role-based access control is still enforced in code (`OWNER`, `ADMIN`, and future merchant-facing roles) so that the authorization model does not have to be retrofitted when a second person joins. Any new hire or contractor with system access is added to this policy's "Applies to" scope and to the RBAC matrix before their first commit or credential is issued.

## Non-negotiable controls

Two controls are never waived, skipped, or deferred regardless of schedule pressure, per `CLAUDE.md`:

- **Tenant isolation** — no merchant's data is ever reachable from another merchant's session or query path.
- **No double-booking under concurrency** — reservation and inventory invariants hold under real concurrent load, not just sequential tests.

## Enforcement and review

This policy is reviewed whenever the control mapping in `09` changes materially, and at minimum once per phase gate (`G0`–`G10`). Violations discovered in the course of building (a failing scanner, a skipped gate) are recorded in the relevant day's log under `docs/logs/` and in the risk register if not immediately remediated.

## Related policies

[Access Control Policy](access-control-policy.md) · [Data Retention Policy](data-retention-policy.md) · [Incident Response Policy](incident-response-policy.md) · [Secure Development Policy](secure-development-policy.md) · [Vendor Management Policy](vendor-management-policy.md)
