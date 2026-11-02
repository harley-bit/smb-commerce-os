# ADR-003 — Social login: direct Google/Apple now, MFA exempted for OAuth sessions

**Status:** Accepted (founder decision, 2026-09-10)
**Relates to:** `ADR-002-authentication-provider.md` (not superseded — ADR-002's "Auth0 later" stance is unchanged; this is additive, covering a need that came up before that migration).

## Decision

1. Add Google and Apple sign-in **directly** (each provider's own SDK/OAuth flow, verified server-side against that provider's own public keys), rather than waiting for the Auth0 migration ADR-002 anticipated as the eventual path for this kind of need.
2. An account authenticated via Google or Apple **does not** go through `NativeAuthProvider`'s mandatory TOTP MFA enrollment/challenge. Only native email+password accounts do.

## Why

Manually testing D138's mobile sign-in screen surfaced that the app had no sign-up flow at all, and a comparison against a typical consumer sign-in screen (passkey/Google/Apple options) prompted the founder to ask for social login now rather than later. Standing up Auth0 first would be more correct in the abstract (one integration instead of two bespoke ones, later replaced anyway) but is more upfront work than the founder wants to spend before this is needed; direct integration is accepted as the faster, throwaway-when-Auth0-arrives path.

On MFA: Google and Apple already verify the user's identity and typically enforce their own second factor. Also requiring this app's own separate TOTP setup immediately after a one-tap Google/Apple sign-in would be a materially worse first-time experience for no real security gain — the OAuth provider's own assurance is treated as sufficient. Native email+password accounts keep the existing mandatory-MFA posture unchanged; this is a policy split by auth method, not a general relaxation of the MFA requirement.

## What this actually requires

| Concern | Requirement |
|---|---|
| Token verification | Google ID tokens verified against Google's JWKS (`aud` = this app's client id, `iss` = accounts.google.com, signature + expiry checked). Apple identity tokens verified against Apple's rotating public keys (`aud` = the Services ID/bundle id). Client-supplied profile fields are never trusted in place of verified token claims. |
| Account linking | A Google/Apple sign-in with an email that already has a native account links to that same `users` row rather than creating a duplicate — found by email, same identity space as `NativeAuthProvider`. |
| Apple quirks | Name is only returned on the user's *first* authorization ever — capture and store it then, never expect it on a later login. Email may be Apple's private relay address; never assumed to be a reachable, real address for anything. |
| MFA bypass scope | The bypass applies only to the OAuth login path itself (new `/auth/mobile/oauth/google`, `/auth/mobile/oauth/apple` routes) — it must not weaken `authenticate()`'s existing `MFA_REQUIRED_ROLES` check for native password logins. |
| App Store compliance | Apple Guideline 4.8: offering Google sign-in requires also offering Sign in with Apple. Both ship together (D200/D201), satisfying this by construction. |
| External accounts | Google Cloud Console OAuth client (Web/iOS/Android client IDs) and Apple's "Sign In with Apple" capability on the existing Apple Developer account — both founder-provisioned, same pattern as D151's store accounts. |

## Consequences

- `NativeAuthProvider` gains no new methods for password/session handling — the new OAuth verification logic is new, separate code (D200), not a modification of the existing native-auth path, so ADR-002's guarantees for that path are unaffected.
- `users.roles` still gets `["OWNER"]` for every account regardless of auth method — the pre-existing "no distinct customer role" gap (documented in earlier card logs) is unchanged by this decision, not fixed by it.
- When Auth0 is eventually wired in (ADR-002), it should absorb both native and OAuth login paths behind the same `AuthProvider` interface; this ADR's routes become migration targets at that point, same as `NativeAuthProvider` itself.
