# Privacy, Data Protection, and Retention

## Principle

Privacy by design, in the operative sense: **the system cannot retain what it never collects**, and deletion must be a code path built in Phase 1, not a manual process invented under a regulator's deadline.

## Data inventory and classification

| Class | Data | Sensitivity | Where |
|---|---|---|---|
| **Merchant business** | Business name, address, tax ID, bank reference | Confidential | `merchants`, provider |
| **Merchant staff** | Name, email, role | Confidential | `users`, `merchant_users` |
| **Customer identity** | Name, email, phone | **Personal data** | `users` |
| **Transaction** | Orders, lines, intervals, amounts | **Personal data** (links a person to activity, time, and place) | `orders`, `order_lines`, `reservations` |
| **Payment** | Provider references, last four, amounts | Confidential — **no PAN, no CVV** | `payments` |
| **Condition media** | Photographs of assets at handover | **Personal data + evidence** | Object storage |
| **Audit** | Actor, action, IP, user agent | Confidential; contains personal data | `audit_log` |
| **Operational** | Application logs, metrics | Internal | Log store |

**`reservations` is personal data and should be treated as such** even though it holds no name. A row saying a person had a specific asset in a specific place between two times is more revealing than a mailing address, and it is easy to misclassify as "just scheduling."

## Data minimization

Collected because a transaction requires it: customer name, email, and phone (booking confirmation and contact on a late return); billing postcode where the payment provider requires it.

**Not collected:** date of birth, government ID, precise geolocation, marketing profile data, social identifiers, or anything speculative for a future feature.

One deliberate exception, and it is not personal data: `inventory_units.acquisition_cost_minor`, `acquired_at`, `expected_life_months`, and the rental movement pairs. These are merchant business data captured for later utilisation analysis, justified on cost asymmetry — free now, impossible to reconstruct. No personal data is collected on that basis.

## Condition media — the hard case

Photographs taken at handover and return are simultaneously:

- **Evidence** in a financial dispute — delete too early and a damage claim is unwinnable, and a customer wrongly charged has no way to contest it either.
- **A liability** — they may incidentally capture people, faces, vehicle plates, or property, and they accumulate indefinitely if left alone.

**Policy:**

| Rule | Value |
|---|---|
| Retention when no claim is filed | **90 days** after rental completion, then automatic deletion |
| Retention when a claim is filed | 2 years after claim resolution, or longer if a dispute is live |
| Storage | Private bucket, randomized keys, server-side encryption |
| Access | Short-lived signed URLs only; never public |
| Integrity | SHA-256 recorded at upload; keys never overwritten |
| Merchant guidance | Photograph the asset, not the customer; surfaced in the capture UI |

Automatic deletion is a scheduled job with a dry-run mode and a deletion audit record. **The retention clock is set in Phase 4 when the feature is built**, not deferred — a media store without a retention policy becomes one that cannot be given a policy later, because nobody can decide what to do with the backlog.

## Retention schedule

| Data | Retention | Basis |
|---|---|---|
| Order and payment records | 7 years | Financial recordkeeping and tax |
| Reservations | 7 years, with customer identity dissociated at 2 years | Ties to orders; identity not needed for the full period |
| Condition media | 90 days / 2 years with claim | Above |
| Audit log | 7 years | Financial and security investigation |
| Application logs | 90 days | Operational need |
| Deleted customer accounts | Identity erased within 30 days; transaction records anonymized | Subject rights vs. financial retention |
| Abandoned carts and expired holds | 30 days | No ongoing purpose |

**Anonymization, not deletion, for transaction history.** When a customer exercises deletion rights, the order must survive for the merchant's tax and accounting obligations, but the person need not. The record is retained with the identity replaced by a tombstone reference. This is designed in Phase 1 as a first-class operation — an `anonymizeCustomer(userId)` path with tests — because retrofitting it means hand-writing SQL against production under time pressure.

## Subject rights

Built in Phase 1, before any real customer data exists:

| Right | Implementation |
|---|---|
| Access | Export a customer's data as JSON via an authenticated endpoint |
| Portability | Same export, machine-readable |
| Deletion / erasure | `anonymizeCustomer` — identity erased, financial records tombstoned |
| Correction | Self-service profile editing |
| Objection / restriction | Marketing flags; the platform sends no marketing in the MVP |

The MVP sends transactional messages only — booking confirmations, reminders, return-due, deposit release. No marketing email, which keeps consent management out of the MVP entirely.

## Regulatory posture

**United States.** State comprehensive privacy laws (California's CCPA/CPRA and the growing set of others) apply on thresholds a pre-revenue platform generally falls under — but the thresholds arrive sooner than founders expect, and the controls are far cheaper to build than to bolt on. The plan therefore builds access, deletion, and disclosure capability regardless of whether any statute yet compels it.

**Payments.** PCI DSS SAQ A, preserved by the architectural decision that card data never touches our servers (`07`). Any change to that requires an ADR.

**Europe.** GDPR is not a Phase 1 obligation — no EU market is being served. But two design decisions made now determine whether it is later feasible or a rewrite: collecting seller identity data at onboarding, and having a working deletion path. Both are in the plan. The EU-specific obligations (DAC7 platform reporting, DSA trader traceability) are product features and are out of scope until an EU launch is real.

## Sub-processors

Maintained in `/docs/compliance/subprocessors.md` from Phase 0, with purpose, data categories, and location for each: identity provider, payment provider, hosting, object storage, email/SMS, error tracking, analytics.

**Error tracking and analytics deserve specific scrutiny.** Both routinely capture more than intended — request bodies, user identifiers, session replays. Configure field scrubbing before the first event is sent, not after a review finds personal data in a third-party dashboard.

## Breach response

An incident response plan lives in `/docs/compliance/incident-response.md` from Phase 0, covering detection, severity classification, containment, assessment against state breach-notification thresholds, notification, and post-incident review.

**Written before it is needed, and rehearsed once in Phase 9.** A plan that has never been exercised is a document, not a capability. The founder's GRC background makes this cheap to produce well — and existing templates from the founder's own GRC knowledge base are a reasonable starting point rather than drafting from scratch.
