# Control Mapping — Pointer

The authoritative control mapping document is [`docs/design/09_compliance_control_mapping_and_evidence.md`](../design/09_compliance_control_mapping_and_evidence.md). It is kept in `docs/design/` rather than duplicated here because this repository's convention (`CLAUDE.md`) is that design docs are the single source of truth for architecture and control decisions, and a second copy under `docs/compliance/` would drift the first time one of them was edited without the other.

This file exists only because `09`'s own evidence-repository layout names `docs/compliance/control-mapping.md` as a path ("this document, kept current") — it is satisfied here as a pointer rather than a duplicate, consistent with how `docs/compliance/incident-response.md` and `docs/compliance/subprocessors.md` also reference their governing design docs rather than restating them.

## What's in `09`

- Framework posture (PCI DSS SAQ A in scope now; SOC 2 controls built now, attestation deferred; NIST CSF 2.0 as the organizing spine; state privacy law in scope; GDPR readiness only; ISO 27001 out of scope).
- The full Govern/Identify/Protect/Detect/Respond/Recover control table, each row naming its evidence artifact and the phase that produces it.
- PCI DSS SAQ A eligibility conditions and how each is preserved.
- The SOC 2 control-family mapping (CC6–CC9, A1).
- The evidence-repository layout itself (`docs/compliance/` structure).

## Change process

Any change to the control mapping is an edit to `09`, submitted as a pull request like any other design-doc change (`docs/design/17_change_management_policy.md`) — never a direct edit to this pointer file, which should only ever need to change if `09` is renamed or the evidence layout itself changes.
