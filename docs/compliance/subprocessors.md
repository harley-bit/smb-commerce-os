# Sub-processor Inventory

Required by [`policies/vendor-management-policy.md`](policies/vendor-management-policy.md) and the CC9 (Risk Mitigation) control in `docs/design/09_compliance_control_mapping_and_evidence.md`. Data categories follow the classification in `docs/design/08_privacy_data_protection_and_retention.md`. Covers the seven functions that doc names as required from Phase 0: identity, payment, hosting, object storage, email/SMS, error tracking, analytics.

**As of this entry (Phase 0, D012), no application code exists yet — this repo is CI tooling and an in-memory `AuthProvider` only.** Nothing below is wired into a running system. This inventory is filed now, per policy ("added before its integration merges, not after"), against the providers the design docs already name as the intended choice, so the record exists before the first real integration rather than being reconstructed afterward.

| Vendor | Function | Data category touched | Status | Compliance posture last confirmed | Integrating phase |
| --- | --- | --- | --- | --- | --- |
| AWS Cognito | Identity provider (superseded in part — see [ADR-002](../adr/ADR-002-authentication-provider.md)) | Authentication credentials, email | **Not integrated.** Native `AuthProvider` (D010) is in use instead for the MVP; Cognito or Auth0 remains the intended future provider swap, not built yet. | N/A — not integrated | Deferred |
| Stripe (Connect) | Payment provider — hosted card fields, deposit capture, merchant payouts | Payment tokens/references only; **no PAN, CVV, or track data** (`docs/design/07`) | **Not integrated.** Named in `docs/design/01` Phase 5 and `docs/design/07`'s payment-data section. | N/A — not integrated | Phase 5 |
| AWS (Fargate, RDS, ElastiCache) | Hosting — application compute, database, cache | Merchant and customer records, including PII | **Not integrated.** Local development uses SQLite; target architecture in `docs/design/11`. | N/A — not integrated | Phase 11 (production infra) |
| AWS S3 | Object storage — condition-report media | Photos/video of rental assets, may incidentally include identifying background detail | **Not integrated.** Named in `docs/design/11`. | N/A — not integrated | Phase 4 |
| _Not yet selected_ | Email/SMS — transactional notifications (booking confirmations, deposit receipts) | Customer/merchant email address, phone number, transaction details | **Not selected.** No vendor named in the design docs yet; must be evaluated per the vendor-management policy before Phase 6/7 notification work begins. | N/A | Phase 6–7 |
| _Not yet selected_ | Error tracking | Stack traces, request metadata — **field scrubbing required before first event is sent** (`docs/design/08`) | **Not selected.** | N/A | Phase 9 |
| _Not yet selected_ | Analytics | Aggregate usage data | **Not selected.** | N/A | Phase 9 |
| GitHub | Source control, CI/CD (Actions), issue/PR tracking | Source code; no merchant/customer data | **Integrated** (D009) — `github.com/harley-bit/smb-commerce-os` | GitHub's own SOC 2 report is publicly available; not yet individually confirmed by this project | Phase 0 (done) |

## Re-assessment

Per the vendor-management policy: sub-processors are re-confirmed annually, or sooner if a vendor discloses a breach affecting data they hold for this platform. Each row above moves from "Not integrated"/"Not selected" to a confirmed status only once the corresponding phase's integration actually merges, with this table updated in the same PR — never after.
