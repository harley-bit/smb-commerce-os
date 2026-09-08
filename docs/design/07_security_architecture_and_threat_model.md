# Security Architecture and Threat Model

## Posture

Security-first means controls are designed and built **before** the features they protect, not hardened afterwards. Three things in this system cannot be retrofitted without a rewrite:

1. **Tenant isolation** — the data model and every repository signature depend on it.
2. **Audit logging** — a gap in the chain cannot be reconstructed later.
3. **Authorization placement** — checks in controllers instead of services means every new entry point re-introduces the bug.

All three are Phase 0 and Phase 1 work. Everything else can be strengthened incrementally.

## Control #1 — Multi-tenant isolation

The highest-severity risk in the platform. A cross-tenant read is a reportable breach affecting every merchant simultaneously.

**Defence in depth, four layers:**

| Layer                 | Control                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Schema                | `merchant_id` on every tenant-owned table, denormalized even where derivable                                       |
| Type system           | Every repository method takes `TenantContext` as its first parameter — a missing scope is a compile error          |
| Runtime               | Repository base class injects the `merchant_id` predicate; raw query construction is banned outside `/packages/db` |
| Database (PostgreSQL) | Row-level security policies as a backstop, added at cutover                                                        |

**Verification:** an automated test suite that, for **every** repository method, creates two merchants and asserts that merchant A's context cannot read, update, or delete merchant B's rows. This suite is generated from the repository interface so that a new method without a corresponding test fails the build. Gate G1 depends on it.

## Authentication

**Superseded in part by [`docs/adr/ADR-002-authentication-provider.md`](../adr/ADR-002-authentication-provider.md).** The paragraph below (delegated managed IdP, no in-house password storage) was this project's Phase 0 assumption. Founder decision (2026-09-07, D4): build authentication **natively** for the MVP, behind an `AuthProvider` interface, with **Auth0 as the intended future provider** wired in later rather than now. Read ADR-002 for the concrete security requirements this creates (Argon2id hashing, session table, rate limiting, reset-token handling) — they replace "no password storage anywhere" as this system's actual authentication security check. The MFA and secure-storage rules below still apply regardless of provider.

~~**Delegated to a managed identity provider.** No password storage, no reset flows, no session management written in-house. Decision D4 selects the provider; AWS Cognito is the default given the AWS target, with Auth0 or Clerk as alternatives if developer experience outweighs consolidation.~~

~~- OIDC authorization code flow with PKCE for web and mobile.~~
~~- Short-lived access tokens (15 minutes); refresh tokens rotated on use with reuse detection.~~

- **MFA required for `OWNER` and `ADMIN` roles.** These accounts can move money. (Still applies — TOTP, per ADR-002.)
- Mobile tokens in platform secure storage (Keychain / Keystore), never `AsyncStorage`. (Still applies once mobile — Phase 8 — exists.)
- Web session token in an httpOnly, `SameSite=Strict`, Secure cookie — not `localStorage`, which is XSS-readable. (Still applies; see ADR-002 for why this is now an opaque session token rather than a refreshed JWT.)

## Authorization

RBAC enforced at the **service** layer, never the controller.

| Role                  | Scope                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLATFORM_SUPERADMIN` | Everything `PLATFORM_ADMIN` can, plus platform staff role/permission management and dual-control merchant reinstatement                                                   |
| `PLATFORM_ADMIN`      | Everything `PLATFORM_SUPPORT` can, plus merchant lifecycle (suspend/onboard/offboard), platform-wide reporting, feature flags                                             |
| `PLATFORM_SUPPORT`    | Break-glass merchant access, always audit-logged, time-boxed; support actions (void/refund, release a stuck reservation, resend a notification) scoped to an active grant |
| `OWNER`               | Full merchant control including payouts and role assignment                                                                                                               |
| `ADMIN`               | Operations, no payout or role changes                                                                                                                                     |
| `STAFF`               | Day-to-day: bookings, check-in/out, condition reports                                                                                                                     |
| `READ_ONLY`           | View only                                                                                                                                                                 |
| `CUSTOMER`            | Own orders only                                                                                                                                                           |

Rules: default deny — an unlisted action is forbidden; permission checks are a single `assertCan(ctx, action, resource)` call at the top of each service method; **any platform role's access to merchant data is always audit-logged with a reason string**, and access is time-boxed via a `support_access_grants` row — no standing access for any platform role, including `PLATFORM_SUPERADMIN`.

**Platform roles are a separate axis from `merchant_users.role`, not an extension of it** — a platform staff account (`platform_users`, `03`) has no row in `merchant_users`; its only path to a specific merchant's data is a break-glass grant. Full workflow, architecture (a separate `apps/admin`, not a route inside the merchant dashboard), and data model: `16_platform_admin_console.md`. That doc adds controls this section didn't previously need:

- **MFA mandatory for all three platform roles**, not just the top tier — stricter than the `OWNER`/`ADMIN` rule below, because a compromised platform account reaches every merchant, not one.
- **Network-level restriction** on `apps/admin` (IP allowlist or VPN/SSO gateway) — a control category with no prior equivalent in this document.
- **Dual control on merchant reinstatement**: the role that suspends a merchant cannot unilaterally reinstate it; that requires `PLATFORM_SUPERADMIN`.

## Payment data

**Card data never touches our servers.** Stripe hosted fields (Elements / Checkout) only. We store provider references, never PANs, never CVV, never full card numbers.

This is a deliberate architectural decision that keeps the platform in **PCI DSS SAQ A** scope. Any change that puts a card field on our own page moves the platform to SAQ A-EP or SAQ D and multiplies compliance cost — such a change requires an ADR, not a pull request.

## Secrets

Never in the repository. Local development uses `.env` files that are git-ignored and validated at boot against a schema. Production uses AWS Secrets Manager with rotation. `gitleaks` runs pre-commit and in CI; a detected secret fails the build and triggers rotation, since a secret pushed to a remote is compromised regardless of whether the commit is removed.

## Encryption

**In transit:** TLS 1.2 minimum, 1.3 preferred; HSTS with preload; certificate management via ACM. **At rest:** platform-level encryption with KMS on AWS; SQLite development databases contain only synthetic data and are not encrypted — a policy enforced by a CI check that no production data fixture enters the repository.

## Input handling

Zod validation at every API boundary, with the same schema shared by web and mobile (`06`). Parameterized queries only — string-concatenated SQL is banned by lint rule. Output encoding by default through React. A strict Content-Security-Policy with no `unsafe-inline`. File uploads (condition media) restricted by content type and size, scanned, stored outside the web root with randomized keys, and served only through short-lived signed URLs.

## Logging and audit

**Application logs:** structured JSON, correlation ID on every line, no PII, no tokens, no card references. **Audit log:** hash-chained and append-only (`03`), covering money movement, deposit transitions, inventory adjustments, role changes, platform-admin access, and failed authorization attempts.

Hash chaining is chosen over write-only permissions because it makes tampering _detectable_ rather than merely difficult, which is the stronger property when the same operator controls the database.

## Rate limiting and abuse

Per-IP limits on unauthenticated endpoints, per-token limits on authenticated ones. The availability endpoint gets a tighter budget — it is the cheapest endpoint to scrape and the most expensive to compute. Progressive delays on repeated authentication failure, handled by the identity provider. Idempotency keys required on money-moving and reservation-creating POSTs.

---

# STRIDE Threat Model

Scoped to the MVP. Reviewed at every phase gate and updated when a new trust boundary appears.

## Trust boundaries

```
[Public internet] → [CDN/WAF] → [API] → [Database]
                                  ↓
                          [Stripe] [Identity provider] [Object storage]
```

Boundaries: unauthenticated public ↔ API; customer ↔ merchant data; **merchant ↔ merchant** (the critical one); application ↔ payment provider; application ↔ object storage.

## Analysis

### Spoofing

| Threat                                                  | Severity     | Mitigation                                                                                       |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| Credential stuffing on merchant accounts                | High         | Managed IdP with breach-password detection; MFA on OWNER/ADMIN; progressive delays               |
| Forged Stripe webhooks triggering deposit release       | **Critical** | Signature verification before parsing; unverified events discarded and logged as security events |
| Session hijacking via stolen token                      | High         | Short-lived tokens; refresh rotation with reuse detection; httpOnly Secure cookies               |
| Customer impersonation to view another's rental history | Medium       | Authorization checked against `customer_user_id` on every order read                             |

### Tampering

| Threat                                                       | Severity     | Mitigation                                                                                   |
| ------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------- |
| Price manipulation in a checkout request                     | **Critical** | Prices are **never** accepted from the client. Server recomputes every line from the catalog |
| Condition photos altered to support or defeat a damage claim | High         | SHA-256 recorded at upload; immutable object storage; no overwrite of an existing key        |
| Reservation interval edited to seize a booked slot           | High         | Intervals immutable after `CONFIRMED`; changes are cancel-and-rebook, audit-logged           |
| Audit log modification                                       | High         | Hash chain; verification job flags any break                                                 |
| Deposit amount altered before capture                        | **Critical** | Capture amount bounded by the authorized amount; single capture; audit-logged                |

### Repudiation

| Threat                                    | Severity | Mitigation                                                                                  |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| Merchant denies capturing a deposit       | High     | Hash-chained audit log with actor, timestamp, IP                                            |
| Customer denies agreeing to deposit terms | Medium   | Explicit consent captured at checkout with version of terms and timestamp                   |
| Dispute over asset condition at handover  | High     | Condition report **required** before `IN_USE`, with hashed timestamped media at both phases |

### Information disclosure

| Threat                                          | Severity     | Mitigation                                                              |
| ----------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| **Cross-tenant data access**                    | **Critical** | Four-layer isolation; generated cross-tenant test suite; Gate G1        |
| Availability endpoint leaking customer identity | Medium       | Returns free/busy intervals only; explicitly tested                     |
| Enumeration of merchant slugs or order IDs      | Medium       | UUIDv7 identifiers; authorization on every read; rate limiting          |
| Condition media exposed by URL guessing         | High         | Randomized keys; private buckets; short-lived signed URLs only          |
| PII in application logs or error responses      | High         | Structured logging with a field allowlist; generic client-facing errors |
| Stack traces in production responses            | Medium       | Error handler strips detail outside development                         |

### Denial of service

| Threat                                                    | Severity | Mitigation                                                                          |
| --------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| Availability query flooding                               | Medium   | 90-day window cap; caching; per-IP limits; WAF                                      |
| **Hold exhaustion — reserving every slot without paying** | **High** | Short hold TTL; per-IP and per-account concurrent-hold caps; abandonment monitoring |
| Storage exhaustion via media upload                       | Medium   | Size and count limits per report; authenticated uploads only                        |
| Sweeper job contention                                    | Low      | Idempotent, batched, safe to run concurrently                                       |

Hold exhaustion deserves attention: it is cheap to execute, needs no authentication if carts are anonymous, and takes a merchant's entire inventory off sale. Anonymous carts get a stricter concurrent-hold cap than authenticated ones.

### Elevation of privilege

| Threat                               | Severity     | Mitigation                                                                                                                                                                                            |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAFF` escalating to `OWNER`        | High         | Role changes restricted to `OWNER`, audit-logged, notified to all owners                                                                                                                              |
| Customer reaching merchant endpoints | **Critical** | Separate route namespaces; role assertion in every service method; default deny                                                                                                                       |
| Platform admin abuse                 | High         | Break-glass with mandatory reason; time-boxed grant (`support_access_grants`); all access audit-logged and alerted; MFA mandatory for every platform role; network restriction on `apps/admin` (`16`) |
| IDOR on order or reservation IDs     | High         | Ownership verified on every access; never trust an ID alone                                                                                                                                           |

## Highest-priority controls

Ranked by severity × likelihood, these are the ones to build first and test hardest:

1. **Cross-tenant isolation** (Phase 1, Gate G1)
2. **Server-side price computation** — never trust client prices (Phase 2)
3. **Webhook signature verification** (Phase 5)
4. **Deposit capture bounds and single-capture enforcement** (Phase 5)
5. **Condition media integrity and access control** (Phase 4)
6. **Hold exhaustion limits** (Phase 3)

## Review cadence

The model is reviewed at each phase gate, and whenever a new trust boundary, external integration, or data class is introduced. Reviews are recorded in `/docs/compliance/threat-model-reviews/` as evidence for `09`.
