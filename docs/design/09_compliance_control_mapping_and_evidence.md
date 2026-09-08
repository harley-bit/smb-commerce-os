# Compliance Control Mapping and Evidence

## Principle: evidence by design

Compliance documentation is produced **as a by-product of building**, not as a later project. Every control below maps to an artifact the repository or pipeline already generates. Nothing here is a document written to satisfy an auditor and never read again.

The practical test: if an auditor asks "show me that only authorized people can access merchant data," the answer is a passing test suite and a policy file in version control, not a screenshot taken the week before the audit.

## What is in scope now, and what is not

| Framework | Posture | Rationale |
|---|---|---|
| **PCI DSS v4.0, SAQ A** | **In scope now** — complete in Phase 9 | Required to process cards. Cheap because card data never touches our servers |
| **SOC 2 Type II** | **Controls built now, attestation deferred** | Build the controls; pursue the report when a customer or investor requires it. Attestation before product-market fit is a classic misallocation |
| **NIST CSF 2.0** | Used as the organizing framework | Free, comprehensive, and maps onward to SOC 2 and ISO 27001 without rework |
| **US state privacy laws** | Capability built now (`08`) | Thresholds arrive sooner than expected; retrofit is expensive |
| **GDPR** | Readiness only | No EU market in the MVP. Two design decisions preserve the option (`08`) |
| **ISO 27001** | Out of scope | No market requirement at this stage |

Choosing NIST CSF 2.0 as the spine is deliberate: it is the cheapest framework to organize around that maps cleanly to SOC 2 later, so no control work is wasted if an attestation becomes necessary.

## Control mapping

Each control names the artifact that evidences it and the phase that produces it.

### Govern (GV)

| Control | Evidence artifact | Phase |
|---|---|---|
| Security policy set | `/docs/compliance/policies/` in version control | 0 |
| Risk register maintained | `14_risk_register_technical.md`, reviewed weekly (`13`) | 0, ongoing |
| Roles and responsibilities | RBAC matrix (`07`) + policy | 0 |
| Sub-processor inventory | `/docs/compliance/subprocessors.md` | 0 |
| Change management | Pull request history, branch protection settings, ADRs — process documented in `17_change_management_policy.md` | 0, ongoing |

### Identify (ID)

| Control | Evidence artifact | Phase |
|---|---|---|
| Asset inventory | Infrastructure-as-code definitions | 0, 11 |
| Data inventory and classification | `08`, data classification table | 0 |
| Threat model | `07`, plus dated review records | 0, each gate |
| Dependency inventory | Generated SBOM per build, retained as a CI artifact | 0, ongoing |
| Vulnerability identification | Dependency and SAST scan results in CI | 0, ongoing |

### Protect (PR)

| Control | Evidence artifact | Phase |
|---|---|---|
| **Tenant isolation** | Generated cross-tenant test suite; Gate G1 record | 1 |
| Identity and authentication | IdP configuration; MFA enforcement policy | 0 |
| Authorization | RBAC matrix; service-layer assertion tests | 1 |
| Least privilege — infrastructure | IAM policies in infrastructure-as-code | 11 |
| Encryption in transit | TLS configuration; SSL Labs scan result | 0, 9 |
| Encryption at rest | KMS configuration | 11 |
| Secrets management | Secrets Manager config; `gitleaks` results | 0 |
| Secure development | Pipeline definition; branch protection; review requirement | 0 |
| Data retention and disposal | Retention job code and its execution logs | 4, 8 |
| Backup | Backup configuration plus **restore rehearsal record** | 10 |

### Detect (DE)

| Control | Evidence artifact | Phase |
|---|---|---|
| Audit logging | `audit_log` schema; hash-chain verification job output | 1 |
| Security event monitoring | Alert definitions; alert history | 9 |
| Anomaly detection | Failed-auth and failed-authorization alerting | 9 |
| Log integrity | Hash-chain verification results | 1, ongoing |

### Respond (RS) and Recover (RC)

| Control | Evidence artifact | Phase |
|---|---|---|
| Incident response plan | `/docs/compliance/incident-response.md` | 0 |
| Incident response exercise | Tabletop exercise record | 9 |
| Breach notification procedure | Documented decision tree with state thresholds | 0 |
| Recovery plan and RTO/RPO | Documented targets plus restore rehearsal | 10 |

## PCI DSS SAQ A — eligibility and preservation

Eligibility rests on a single architectural fact: **all cardholder data functions are outsourced to a validated provider, and no card data touches our systems.** Preserved by four conditions, each tested:

| Condition | How it is preserved |
|---|---|
| Card fields are provider-hosted iframes only | Test asserts no card input exists in our own DOM |
| No PAN, CVV, or track data stored, processed, or transmitted | Schema review; automated scan for card-shaped patterns in database and logs |
| Payment page integrity | CSP restricting script sources; script-integrity monitoring (a v4.0 requirement) |
| Provider's own compliance validated annually | Attestation retained in `/docs/compliance/` |

**Any change that puts a card field on our page changes the SAQ type and multiplies compliance cost. Such a change requires an ADR, never a pull request.**

## SOC 2 — controls now, report later

Built during the phases above, so that pursuing a report later is an audit of existing practice rather than a remediation project:

- **CC6 Logical access** — RBAC, MFA, tenant isolation, access reviews
- **CC7 System operations** — monitoring, alerting, incident response
- **CC8 Change management** — pull requests, reviews, ADRs, CI gates
- **CC9 Risk mitigation** — risk register, vendor management
- **A1 Availability** — backups, recovery targets, restore rehearsal

The access review is the one control that needs a recurring human action rather than an artifact: a quarterly review of who holds which role, recorded. Everything else is generated.

## Evidence repository

```
/docs/compliance/
  policies/                    information security, access control, data retention,
                               incident response, secure development, vendor management
  threat-model-reviews/        dated review records
  access-reviews/              quarterly role reviews
  incident-response.md
  subprocessors.md
  pci-saq-a/                   completed SAQ and provider attestations
  control-mapping.md           this document, kept current
  evidence/                    exported CI artifacts: SBOMs, scan results, gate records
```

**Policies live in version control**, reviewed through pull requests like code. This gives change history, approval records, and effective dates for free — which is precisely what an auditor asks for and what a wiki page cannot produce.

The founder's existing GRC knowledge base is the natural source for policy templates. Adapting audit-ready templates already written is materially faster than drafting from scratch, and it keeps this platform's policy set consistent with the founder's own standards.

## Automated evidence collection

Produced by CI on every build and retained: SBOM, dependency scan, SAST, secret scan, test results including the tenant-isolation suite, and coverage. Produced per gate: the gate acceptance record. Produced on a schedule: hash-chain verification, retention job execution, backup verification.

## What is deliberately not done

No compliance automation platform in the MVP — it is a subscription cost that automates evidence collection the pipeline already does. No SOC 2 attestation before a customer requires it. No ISO 27001. No penetration test before Phase 9, when there is something meaningful to test.
