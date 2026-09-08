# Incident Response Policy

**Effective date:** 2026-09-08
**Version:** 1.0
**Owner:** Founder / Head of Engineering
**Applies to:** Any suspected or confirmed security incident affecting `smb-commerce-os` systems, code, infrastructure, or the data it processes.
**Revision history:** Version-controlled; changes ship as pull requests against `main`, and the git log for this path is the record of how the response process has evolved.

## Purpose

States how a security incident is detected, triaged, contained, and closed out, and when it must be disclosed — so that response is a rehearsed procedure, not an improvisation under pressure. Maps to the Respond (RS) and Recover (RC) functions of NIST CSF 2.0 in `docs/design/09_compliance_control_mapping_and_evidence.md`.

## What counts as an incident

Any of the following, confirmed or reasonably suspected:

- Unauthorized access to merchant or customer data, or to production credentials/infrastructure.
- A tenant-isolation violation of any kind — automatically the highest severity, since it is a breach by definition (`CLAUDE.md`'s Gate G1).
- Loss, corruption, or unavailability of production data not attributable to a planned maintenance action.
- A vulnerability disclosed by a scanner (dependency, SAST, secret scan) that reached `main` before being caught, or was reported externally.
- Any event a reasonable person would call a security incident, even if it doesn't fit the categories above.

## Severity and response targets

| Severity | Example | Initial response |
|---|---|---|
| **Critical** | Confirmed cross-tenant data exposure, credential compromise, active exploitation | Immediate containment; work stops on everything else until contained |
| **High** | High/critical CVE reachable in production, failed-auth spike suggesting credential stuffing | Contained and assessed within the same working session |
| **Medium** | A scanner finding caught in CI before merge, a near-miss | Fixed before the next merge to `main` |
| **Low** | Theoretical finding with no realistic exploit path | Logged in the risk register (`docs/design/14_risk_register_technical.md`) for the next weekly review |

## Response steps

1. **Detect** — via CI scanners, monitoring/alerting (Phase 9), or external report.
2. **Contain** — revoke affected sessions/credentials, roll back or patch the vulnerable code, or take the affected system offline if containment requires it.
3. **Eradicate** — fix the root cause, not just the symptom; add a regression test that would have caught it, matching this repo's test-first discipline.
4. **Recover** — restore normal operation; if data was affected, follow the recovery plan and RTO/RPO targets (Phase 10).
5. **Document** — a written incident record under `docs/compliance/incident-response.md`'s log, dated, with timeline, impact, and remediation.

## Breach notification

**Trigger:** any incident involving unauthorized access to, or acquisition of, customer or merchant personal information triggers a breach notification assessment under applicable state privacy law thresholds (`docs/design/08_privacy_data_protection_and_retention.md`). The assessment and any resulting notification decision follows the documented decision tree referenced in `docs/design/09_compliance_control_mapping_and_evidence.md` ("Breach notification procedure"). When in doubt about whether a threshold is met, the default is to assess formally rather than assume it doesn't apply.

## Exercises

A tabletop incident-response exercise is scheduled for Phase 9, once there is a live system with real user traffic to make the exercise meaningful. Until then, this policy itself is the rehearsal artifact, reviewed at each phase gate.

## Related policies

[Information Security Policy](information-security-policy.md) · [Data Retention Policy](data-retention-policy.md) · [Access Control Policy](access-control-policy.md)
