# Access Control Policy

**Effective date:** 2026-09-08
**Version:** 1.0
**Owner:** Founder / Head of Engineering
**Applies to:** All human and service access to `smb-commerce-os` systems, source control, infrastructure, and merchant/customer data.
**Revision history:** Version-controlled; changes ship as pull requests against `main` and the git log for this path is the record of who changed what and when.

## Purpose

States how access to systems and data is granted, authenticated, authorized, and revoked, so that "only authorized people can reach merchant data" has a testable, documented answer — per the CC6 (Logical Access) control family in `docs/design/09_compliance_control_mapping_and_evidence.md`.

## Principles

- **Least privilege.** Every actor — human or service — gets the minimum role needed for its function, never a broader one for convenience.
- **Role-based access control (RBAC).** Authorization is expressed as roles (`OWNER`, `ADMIN`, and future merchant-staff/platform-staff roles per `docs/design/16_platform_admin_console.md`), not per-user ad hoc grants. The role matrix is defined in `docs/design/07_security_architecture_and_threat_model.md` and enforced in code, with a service-layer assertion test for every authorization-sensitive endpoint.
- **Tenant isolation is absolute.** No role, including platform-staff break-glass access, reaches another merchant's data without an explicit, audited, time-boxed grant (Phase 11).

## Authentication

Implemented natively (`packages/domain/src/auth/AuthProvider.ts`, `apps/api/src/auth/NativeAuthProvider.ts`), behind a provider interface so a future swap to a managed IdP (Auth0, per ADR-002) is a provider change, not a rewrite:

- Passwords are hashed with **Argon2id**, never stored or logged in plaintext.
- **TOTP-based multi-factor authentication is mandatory for `OWNER` and `ADMIN` roles.** No such account can complete login without a confirmed MFA enrollment (`otpauth`, SHA1/6-digit/30s window).
- Sessions are opaque, server-side, and individually revocable — no long-lived bearer JWTs that can't be killed on demand.
- Login and password-reset endpoints are rate-limited per IP and per account, with progressive lockout, and password resets use hashed single-use tokens.
- A CSRF origin-check guards state-changing requests.

## Authorization

- Every endpoint that touches merchant or customer data has an explicit authorization check tied to the RBAC matrix; this is enforced as a per-endpoint test requirement in `docs/design/10_secure_sdlc_ci_and_quality_gates.md`'s Definition of Done.
- Prices, totals, and anything financial are always recomputed server-side; a client-supplied value is never trusted for authorization or money decisions.

## Provisioning and de-provisioning

- Access is granted only after this policy and the RBAC matrix are updated to include the new role or person.
- Access is revoked (sessions killed, credentials rotated, infrastructure IAM entries removed) the same day a person's role ends or a service credential is retired.

## Access review

A quarterly review of who holds which role is recorded under `docs/compliance/access-reviews/`. This is the one CC6 control that requires a recurring human action rather than an automatically generated artifact — everything else (MFA enforcement, session revocation, tenant isolation) is verified by the test suite on every build.

## Related policies

[Information Security Policy](information-security-policy.md) · [Secure Development Policy](secure-development-policy.md) · [Incident Response Policy](incident-response-policy.md)
