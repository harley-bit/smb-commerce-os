# ADR-002 — Authentication: Native Now, Auth0-Ready Later

**Status:** Accepted (founder decision, 2026-09-07)
**Supersedes:** the authentication approach assumed in `docs/design/07_security_architecture_and_threat_model.md` ("Authentication" section) and the original D010 card, both of which assumed a managed identity provider (Cognito/Auth0/Clerk) from Phase 0.

## Decision

Build authentication **natively** (in `apps/api`, backed by our own database) for the MVP, behind an `AuthProvider` interface. **Auth0 is the intended future provider**, but wiring it in now is explicitly deferred — the interface exists so that swap is a provider-implementation change, not an authentication rewrite.

## Why this changes the original plan

`docs/design/07` argued for delegating authentication entirely: "No password storage, no reset flows, no session management written in-house." That argument is sound in the abstract — it's real security surface this team doesn't have to own. The founder's decision overrides it anyway, for reasons outside pure security-engineering optimality (cost, control, or timing not to be second-guessed here). Accepting that, this ADR's job is to make native auth **as safe as it can be**, not to relitigate the choice.

## What this actually requires (unlike the original plan, we cannot assume this away)

| Concern | Requirement |
|---|---|
| Password storage | **Argon2id** (not bcrypt, not SHA-anything) with per-user salt. Never log, never include in any error message or audit `before_json`/`after_json`. |
| Session management | Server-side session table (`sessions`: `id`, `user_id`, `created_at`, `expires_at`, `revoked_at`, `ip`, `user_agent`), opaque session token in an httpOnly, `SameSite=Strict`, Secure cookie — not a JWT in this phase; a JWT invites the "how do we revoke it" problem natively-built auth is least equipped to solve well on day one. |
| Password reset | Time-limited, single-use, hashed reset token (never store or email the raw token twice — email once, store only its hash). Expire in 30 minutes. |
| Rate limiting | Login and reset-request endpoints rate-limited per-IP and per-account from Phase 0, not added later — credential stuffing is the first thing a native login endpoint gets hit with. |
| Account lockout / backoff | Progressive delay after repeated failed logins on one account. |
| MFA for `OWNER`/`ADMIN` | Still required per `docs/design/07` — TOTP (e.g., via a standard library), not SMS. This does not get to slip just because auth is native now. |
| CSRF | Required on any state-changing request that relies on the session cookie (standard double-submit or `SameSite=Strict` plus origin checks). |

This is materially more Phase 0 work than "integrate Cognito and get PKCE working," and that cost is accepted knowingly, not discovered later.

## The `AuthProvider` interface (so Auth0 is a swap, not a rewrite)

```ts
// packages/domain/auth/AuthProvider.ts
interface AuthProvider {
  authenticate(email: string, password: string): Promise<AuthResult>;
  createSession(userId: string): Promise<Session>;
  verifySession(token: string): Promise<TenantContext | null>;
  revokeSession(token: string): Promise<void>;
  initiatePasswordReset(email: string): Promise<void>;
  completePasswordReset(token: string, newPassword: string): Promise<void>;
}
```

`apps/api` depends only on this interface. Phase 0 ships a `NativeAuthProvider` implementation. A future `Auth0Provider` implementation satisfies the same interface — the migration is: stand up Auth0, migrate or dual-write users, swap the bound implementation, retire `NativeAuthProvider`. No controller, service, or route changes when that day comes, provided nothing outside `packages/domain/auth` ever imports `NativeAuthProvider` directly.

## Consequences

- D010 (`docs/cards/D010.md`) is rewritten from "identity provider spike / OIDC PKCE" to "native AuthProvider implementation" — see that file for the revised task, deliverable, acceptance criteria, and security check.
- `docs/design/07`'s Authentication section is now partially superseded; a pointer note there directs to this ADR rather than rewriting that document wholesale.
- D4 in `docs/BUILD_STATE.md` is answered: native now, Auth0 later, tracked as this ADR rather than as an open blocking decision.
- Threat model (`docs/design/07` STRIDE section) gains real spoofing/tampering surface area that a delegated IdP would have absorbed (credential stuffing, session fixation, reset-token leakage) — these must be reflected in the Phase 0/1 threat-model review, not silently assumed covered by "MFA + managed IdP" language that no longer fully applies.
- When Auth0 is wired in later, this ADR should be marked **Superseded by ADR-00X** rather than deleted, so the history of why native auth existed at all is not lost.
