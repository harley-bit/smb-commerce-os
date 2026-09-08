# Data Retention Policy

**Effective date:** 2026-09-08
**Version:** 1.0
**Owner:** Founder / Head of Engineering
**Applies to:** All merchant, customer, and payment-adjacent data stored or processed by `smb-commerce-os`.
**Revision history:** Version-controlled; changes ship as pull requests against `main`, and the git log for this path is the record of when retention rules changed and why.

## Purpose

States how long data is kept, why, and how it is disposed of, so that data minimization and lawful retention are decided in advance rather than improvised under a deletion request or an audit question. The full data classification table, legal basis, and per-category retention periods live in `docs/design/08_privacy_data_protection_and_retention.md` — this policy is the governance layer that points to that design doc and commits to enforcing it.

## Principles

- **Data minimization.** Collect only what a feature genuinely needs; classify every new data field per `08` before it ships (this is a Definition-of-Done item in `docs/design/10_secure_sdlc_ci_and_quality_gates.md`).
- **No card data retention.** Cardholder data never touches our servers — hosted fields only, per PCI DSS SAQ A eligibility (`docs/design/09_compliance_control_mapping_and_evidence.md`). This is architectural, not a retention rule, and is the cheapest possible compliance posture for card data.
- **Retention has an end.** Every data category in `08`'s classification table has an assigned retention period and a disposal mechanism; "keep forever by default" is not an acceptable answer for any category.
- **Deletion is enforced in code, not by hand.** Retention and disposal run as scheduled jobs against the schema (Phase 4/8), and their execution logs are themselves the evidence artifact for this control.

## Categories (see `08` for the authoritative table)

At minimum, the classification table distinguishes: account and authentication data, merchant business data, customer PII, transaction/financial records (subject to longer statutory retention independent of this policy), and operational logs/audit trail data (subject to the hash-chain integrity requirement in `docs/design/09`, Detect controls).

## Disposal

- Disposal means the data is irrecoverable from production systems and from routine backups once the backup's own retention window elapses (Phase 10, backup/restore design).
- Deletion requests arising from privacy law (state privacy laws now, GDPR readiness per `08`) are honored within the timeframe that law requires, tracked against the specific request, not batched silently into a routine job.

## Enforcement

Retention job code and its execution logs are the evidence artifact for this control (`09`, Protect: "Data retention and disposal"). Until those jobs exist (Phase 4/8), any manual deletion is logged in the relevant day's build log under `docs/logs/`.

## Related policies

[Information Security Policy](information-security-policy.md) · [Vendor Management Policy](vendor-management-policy.md) · [Incident Response Policy](incident-response-policy.md)

See also: `docs/design/08_privacy_data_protection_and_retention.md` for the full classification table and legal-basis analysis this policy governs.
