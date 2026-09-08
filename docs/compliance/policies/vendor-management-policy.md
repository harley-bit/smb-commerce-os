# Vendor Management Policy

**Effective date:** 2026-09-08
**Version:** 1.0
**Owner:** Founder / Head of Engineering
**Applies to:** All third-party services, sub-processors, and open-source dependencies used to build or operate `smb-commerce-os`.
**Revision history:** Version-controlled; changes ship as pull requests against `main`, and the git log for this path is the record of when a vendor was added, changed, or removed.

## Purpose

States how third-party services that touch merchant, customer, or payment-adjacent data are evaluated, tracked, and re-assessed, so that the sub-processor inventory required by CC9 (Risk Mitigation) in `docs/design/09_compliance_control_mapping_and_evidence.md` is a maintained artifact rather than a one-time list.

## Sub-processor inventory

Every vendor that stores, processes, or transmits merchant or customer data is tracked in `docs/compliance/subprocessors.md`, including: the vendor's name and function, what data category it touches (per the classification in `docs/design/08_privacy_data_protection_and_retention.md`), and the date its own compliance posture (SOC 2 report, PCI attestation, etc.) was last confirmed. A vendor is added to that inventory before its integration merges, not after.

## Card data and PCI DSS SAQ A

The single largest vendor-risk decision in this system is architectural: **all cardholder data functions are outsourced to a validated payment provider, and no card data touches our servers.** This is what makes SAQ A (the lightest PCI DSS validation tier) the applicable standard, per `docs/design/09_compliance_control_mapping_and_evidence.md`. That eligibility is preserved by:

- Card fields are the provider's own hosted iframes only — never rendered by our own DOM inputs.
- No PAN, CVV, or track data is ever stored, processed, or transmitted by our systems.
- Payment page integrity is enforced by CSP restricting script sources plus script-integrity monitoring.
- The provider's own PCI compliance is validated annually, and that attestation is retained under `docs/compliance/pci-saq-a/`.

**Any change that would put a card field on our own page changes the SAQ type and materially multiplies compliance cost — such a change requires an ADR, never a routine pull request.**

## Evaluating a new vendor

Before a new third-party service is integrated:

1. Classify what data category (if any) it will touch, per `08`.
2. Confirm its own security posture is adequate for that data category (a published SOC 2 report or equivalent for anything beyond public/non-sensitive data).
3. Add it to `docs/compliance/subprocessors.md`.
4. If it touches payment card data in any way, stop and write an ADR first — see above.

## Open-source dependencies

Dependencies are a vendor relationship too, evaluated continuously rather than at intake:

- Every build generates a CycloneDX SBOM (via syft), retained as a CI artifact, so the current dependency inventory is always known.
- `pnpm audit --audit-level=high` fails the build on any high/critical vulnerability with an available fix, both in CI and locally via the pre-push hook.
- A dependency is not added to reduce short-term effort if it duplicates functionality already in the stack, per the same judgment applied to internal abstractions.

## Re-assessment

Sub-processors are re-confirmed annually (or sooner if a vendor discloses a breach affecting data they hold for us), matching the cadence of the PCI provider attestation check above.

## Related policies

[Information Security Policy](information-security-policy.md) · [Data Retention Policy](data-retention-policy.md) · [Secure Development Policy](secure-development-policy.md)
