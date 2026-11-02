# Incident Response Plan and Log

This is the operational companion to [`policies/incident-response-policy.md`](policies/incident-response-policy.md) — the policy states the rules (what counts as an incident, severity targets, breach-notification trigger); this document is where the response is actually run and where every real incident is recorded, per the policy's step 5 ("Document") and per `docs/design/09_compliance_control_mapping_and_evidence.md`'s evidence-repository layout, which names this exact path as the Respond/Recover (RS/RC) evidence artifact.

## How to run a response (quick reference)

Full detail in the policy; this is the checklist to work from during an actual incident:

1. **Detect** — via a CI scanner (gitleaks, semgrep, `pnpm audit`), monitoring/alerting (Phase 9), or an external report.
2. **Contain** — revoke affected sessions/credentials (`NativeAuthProvider.revokeSession`, D010), roll back or patch the vulnerable code, or take the affected system offline if that's what containment requires.
3. **Eradicate** — fix the root cause, add a regression test that would have caught it (this repo's test-first discipline applies to incident fixes too).
4. **Recover** — restore normal operation; if data was affected, follow the recovery plan and RTO/RPO targets (Phase 10, not yet built).
5. **Document** — add a dated entry to the log below before closing the incident out.

**Tenant-isolation violations are automatically Critical severity** — a cross-tenant read or write is a breach by definition (`CLAUDE.md` Gate G1), not a judgment call.

**Breach notification assessment:** triggered by any incident involving unauthorized access to, or acquisition of, customer or merchant personal information. Assess against the state-privacy-law thresholds in `docs/design/08_privacy_data_protection_and_retention.md` and the decision tree named in `docs/design/09_compliance_control_mapping_and_evidence.md`. When in doubt, assess formally rather than assume the threshold isn't met.

## Escalation and roles

There is no dedicated security team at this stage of the build — the founder (also `OWNER`/repo admin) is the sole incident responder. `docs/compliance/policies/incident-response-policy.md`'s Owner line (Founder / Head of Engineering) is the same person for both roles today; this will be revisited once the team grows past one.

## Incident log

No incidents have occurred as of this entry. Each real incident is logged here, oldest first, with:

| Date | Severity | Summary | Contained | Root cause | Regression test added | Notification required? |
| --- | --- | --- | --- | --- | --- | --- |
| _(none yet)_ | | | | | | |

A near-miss caught entirely by CI before reaching `main` (a blocked secret, a blocked dependency, a blocked SAST finding) is **not** logged here — that is the normal operation of the gates described in `docs/design/10_secure_sdlc_ci_and_quality_gates.md`, not an incident. This log is for anything that required a human response.
