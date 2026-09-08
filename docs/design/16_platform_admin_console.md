# Platform Admin Console — UI Design and Workflow

**Status:** New scope, added 2026-09-08 at founder request. Not present in the original coworker-produced plan (`00`–`14`). This document defines what it is; `01_phasing_and_mvp_definition.md` places it as Phase 11 (`docs/BUILD_CALENDAR.md`, `D177`–`D197`); `07_security_architecture_and_threat_model.md` and `03_domain_model_and_schema.md` are amended to match.

## Why this exists

`07`'s authorization table already assumed a `PLATFORM_ADMIN` role — "support access, break-glass, always audit-logged" — but no phase ever built a surface for it. Without one, "break-glass" access means someone with production database credentials running manual queries, which is worse for every property the threat model cares about: no reason capture, no time-boxing, no consistent audit trail, no separation between read and write. This doc scopes the actual console.

**Chosen breadth: full internal ops console** — not just a read-only support tool. That means merchant lifecycle management, platform-wide reporting, feature flags, and platform staff role/permission management, in addition to the break-glass support workflow `07` already assumed.

## Who this is for

Platform staff — not merchants, not customers. Distinct user population, distinct login, distinct data model. A merchant's `OWNER` role and a platform's `PLATFORM_SUPERADMIN` role must never be the same account or the same session type; conflating them is exactly the "customer reaching merchant endpoints"-class mistake `07`'s STRIDE model already flags as critical, one trust boundary up.

## Roles — mirroring the existing least-privilege pattern

`07` already tiers merchant roles (`OWNER > ADMIN > STAFF > READ_ONLY`). Platform roles get the same treatment instead of one undifferentiated `PLATFORM_ADMIN`:

| Role                  | Can do                                                                                                                                                                                                       | Cannot do                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `PLATFORM_SUPPORT`    | Break-glass merchant lookup (read-only) plus the support-safe actions in Epic B: void/refund an order, release a stuck reservation, resend a notification. Everything scoped to an active, time-boxed grant. | Merchant lifecycle changes, reporting exports, feature flags, managing other platform staff |
| `PLATFORM_ADMIN`      | Everything `PLATFORM_SUPPORT` can, plus merchant lifecycle (suspend, onboard, offboard), platform-wide reporting, feature flag management                                                                    | Reinstating a suspended merchant alone (dual control, below); managing platform staff roles |
| `PLATFORM_SUPERADMIN` | Everything above, plus platform staff role/permission management, reinstating a suspended merchant, and any action explicitly marked dual-control below                                                      | —                                                                                           |

This is a **separate role axis from `merchant_users.role`**, not an extension of it. A platform staff account has no row in `merchant_users` at all; access to a specific merchant only ever happens through a break-glass grant, never through standing membership.

## Architecture — a separate app, not a route inside the merchant dashboard

`apps/admin` (new Next.js app, third member of `apps/{api,web,admin}`), not a `/platform-admin` route tree bolted onto `apps/web`. Reasons, in order of weight:

1. **Blast radius.** A vulnerability in the customer storefront or merchant dashboard should never be one route away from every merchant's data. Separate deployable, separate bundle, separate incident scope.
2. **Network-level control.** `apps/admin` sits behind its own hostname (e.g. `admin.<domain>`) that can be IP-allowlisted or put behind a VPN/SSO gateway at the infrastructure layer — a control that doesn't exist for `07`'s original "route + role check" model and that the STRIDE model's "elevation of privilege" section doesn't currently cover. This is a **new control**, added by this doc.
3. **Different auth realm.** Platform staff authenticate through the same `AuthProvider` interface from ADR-002 (no new auth mechanism to build), but against a distinct user table and session type — never a merchant or customer session upgraded in place.
4. **No bundle cost for 99.9% of users.** Nobody outside platform staff should ever load this app's JS.

`apps/admin` still uses `packages/domain`, `packages/db`, `packages/contracts` — same tenant-scoping and audit-logging primitives, called from a different app shell.

## Data model additions (`03` gets a new section)

- **`platform_users`** — `id`, `email` (unique), `role` (`PLATFORM_SUPPORT | PLATFORM_ADMIN | PLATFORM_SUPERADMIN`), `mfa_enrolled_at`, `status`, `created_at`, `deactivated_at`. No `merchant_id` — this table is explicitly outside tenant scope, and every repository method touching it must be excluded from the standard tenant-isolation test generator (`03`'s cross-tenant suite) with an explicit, reviewed exception rather than a silent skip.
- **`support_access_grants`** — `id`, `platform_user_id`, `merchant_id`, `reason`, `granted_at`, `expires_at`, `revoked_at`. A row here is what turns a break-glass request into a scoped, time-boxed capability. Every read or write a platform user makes against a merchant during the grant window is tagged with the grant's `id` in `audit_log.entity_id`'s companion field (exact column TBD at `D179`, but the requirement is: **every action traces to a grant, and every grant traces to a reason**).
- **`feature_flags`** — `id`, `key` (unique), `description`, `default_enabled`, `created_at`. **`feature_flag_overrides`** — `flag_id`, `merchant_id`, `enabled`, `set_by`, `set_at` — per-merchant override for staged rollouts (e.g., enabling rentals mode for one pilot merchant before general availability).
- **`platform_role_changes`** — append-only, mirrors the existing `role changes` audit requirement in `07`: `id`, `target_platform_user_id`, `old_role`, `new_role`, `changed_by`, `changed_at`, `reason`. Triggers a notification to all `PLATFORM_SUPERADMIN`s, same pattern as `STAFF`→`OWNER` escalation notification in `07`.

All of the above still write through the existing hash-chained `audit_log` for the actual event record; these tables hold the admin-console-specific state the workflows below need, not a parallel audit mechanism.

## Workflows

### 1. Platform staff login

Native auth per ADR-002, against `platform_users` — but **MFA is mandatory for every platform role**, not just the highest tier. `07` currently only requires MFA for merchant `OWNER`/`ADMIN`; platform accounts are higher-value targets than any single merchant account (one compromised `PLATFORM_SUPERADMIN` reaches every merchant), so the bar is higher, not the same. Session lifetime is deliberately shorter than a merchant dashboard session — exact value set at `D178`, default proposal: 30 minutes idle timeout, no "remember me."

### 2. Break-glass merchant access

1. Platform user searches for a merchant (by ID, slug, or email of a merchant user — never free-text search across PII fields without a specific match).
2. Before any merchant data loads, the UI requires a **reason string** (free text, minimum length enforced, no defaults, no "routine check" placeholder accepted by validation).
3. Submitting creates a `support_access_grants` row with a fixed expiry (default 60 minutes, configurable per-incident up to a hard ceiling — exact ceiling set at `D179`, proposed 4 hours).
4. For the grant's lifetime, the platform user can read that merchant's orders, reservations, listings, and (for `PLATFORM_ADMIN`+) take the Epic B support actions below — every single read and write during this window is audit-logged with the grant ID attached.
5. On expiry, access silently drops — no renewal without a **new** reason. No standing access, ever, for any role including `PLATFORM_SUPERADMIN`.
6. The merchant's own `OWNER`s can see (in their dashboard, a small addition to Phase 6 scope) that platform support accessed their account, when, and the reason — transparency by default, not an opt-in.

### 3. Support actions (`PLATFORM_SUPPORT` and above, only inside an active grant)

- **Void or refund an order** — routes through the same payment service used by the merchant dashboard, not a direct database write; the existing Stripe/refund invariants (`07`, Phase 5) apply unchanged.
- **Release a stuck reservation** — forces a `HELD`/`CONFIRMED` reservation to `CANCELLED` outside its normal lifecycle, for cases like a webhook failure leaving a slot locked. This bypasses the domain's normal cancel-and-rebook flow (`03`, Tampering row on reservation edits) deliberately — it is exactly the kind of action that must never be reachable without a grant and must always be audit-logged with before/after state.
- **Resend a notification / replay a webhook event** — operational recovery, not data mutation; lowest-risk action in this epic, still grant-gated for consistency and because a webhook replay can trigger a real side effect (e.g., a duplicate notification).

Each action requires the active grant to still be valid at the moment of execution — checked server-side, not trusted from client state — and is itself an additional confirmation step in the UI (type-to-confirm for anything irreversible).

### 4. Merchant lifecycle

- **Suspend** (`PLATFORM_ADMIN`+): immediate storefront takedown, mandatory reason, notifies the merchant's `OWNER`s. Reversible.
- **Reinstate** (`PLATFORM_SUPERADMIN` only — dual control): a suspension is a trust decision big enough that the same tier that suspended shouldn't unilaterally reverse it. This mirrors the existing "role changes restricted, audit-logged, notified to all owners" pattern in `07`'s elevation-of-privilege row, one level up.
- **Onboard**: create the merchant record and initial `OWNER` invitation — currently this must happen somewhere for the very first pilot merchant even before this phase exists; `D177`'s scope note should confirm whether Phase 6 already has a minimal version of this that Phase 11 subsumes, or whether this is genuinely new.
- **Offboard**: deactivate, per the retention rules already defined in `08_privacy_data_protection_and_retention.md` — this workflow does not invent new retention policy, it triggers the existing one.

### 5. Platform-wide reporting

Aggregate only: GMV, active merchant count, booking volume by mode, take-rate revenue, deposit/damage-claim rates. **No per-customer PII drill-down from the reporting views** — anything requiring a look at a specific customer or order goes through the break-glass grant workflow above, with its reason-and-audit trail, not a reporting query that happens to expose row-level data. This boundary is the reporting epic's most important design constraint, not an incidental detail.

### 6. Feature flags

Global default plus per-merchant override (`feature_flag_overrides`), read by `packages/config` at request time. Primary use case named in this doc: staging a new capability (e.g., a rentals sub-category) on one pilot merchant before general rollout. `PLATFORM_ADMIN`+ can toggle; every toggle is audit-logged with before/after state, same as any other mutating action in this console.

### 7. Platform staff role/permission management

`PLATFORM_SUPERADMIN` only. Create/deactivate `platform_users`, assign/change roles. Every change writes a `platform_role_changes` row and notifies all current `PLATFORM_SUPERADMIN`s — the same escalation-notification pattern `07` already mandates for merchant `STAFF`→`OWNER`, applied to the platform's own staff.

## Security requirements specific to this console (amends `07`)

1. **MFA mandatory for all three platform roles**, not just the top tier — stricter than the merchant-side rule.
2. **Network-level restriction** on `apps/admin` (IP allowlist or VPN/SSO gateway) — a control category `07` doesn't currently have, because nothing in the original plan needed it.
3. **No standing merchant access, for any role.** Every touch of merchant data is grant-scoped and time-boxed. This is stricter than "audit-logged" — it means the _capability itself_ expires, not just that using it leaves a trail.
4. **Dual control on reinstatement** (and any other action `D187`–`D190` identify as similarly irreversible-in-effect) — one role suspends, a higher role must reinstate.
5. **Shorter session lifetime** than merchant or customer sessions.
6. **`platform_users` is excluded from the standard cross-tenant test generator by explicit, reviewed annotation** — not because tenant isolation doesn't matter here, but because this table has no `merchant_id` by design and a blanket exclusion rule would be more dangerous than a deliberate, visible one.

## New gate: G11

**"Platform staff can support the pilot merchant without direct database access, and every such action is grant-scoped, time-boxed, and audit-logged."** Verified by: a test that asserts no merchant-data read succeeds without an active, unexpired grant; a test that asserts every support action produces an audit row containing the grant ID; and a manual review confirming the network restriction on `apps/admin` is actually enforced (not just documented).

## Sequencing relative to the rest of the plan

This phase does not block `G7` (MVP gate — merchant dashboard + customer storefront, web only) or `G10` (first merchant live) in the strict sense that a pilot _could_ launch without it. It is placed as **Phase 11, after Phase 10** in the day sequence so it doesn't renumber any already-built card (`D001`–`D176` are untouched), but the founder should treat **Epic A (`D177`–`D182`, platform auth and break-glass) as effectively required before real support incidents happen** — i.e., before the pilot merchant has been live long enough to generate one. Epics C–E (lifecycle, reporting, feature flags) are genuinely deferrable further if needed; they don't carry the same "someone will need this the first time something breaks" urgency that Epic A does.

## Day-by-day breakdown

See `docs/BUILD_CALENDAR.md` (`D177`–`D197`) and `docs/cards/D177.md`–`D197.md` for the buildable form of this scope. Epics:

| Epic                                | Days          | Focus                                                                                     |
| ----------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| A — Platform auth & break-glass     | `D177`–`D182` | Schema, AuthProvider instance, MFA, grant workflow, audit log viewer, network restriction |
| B — Support actions                 | `D183`–`D186` | Void/refund, release stuck reservation, notification resend, action audit trail           |
| C — Merchant lifecycle              | `D187`–`D190` | Suspend, reinstate (dual control), onboard/offboard, lifecycle audit                      |
| D — Platform reporting              | `D191`–`D193` | Aggregate GMV/booking/revenue views, dashboard UI, CSV export                             |
| E — Feature flags & role management | `D194`–`D197` | Flag schema + UI, platform role management, **Gate G11**                                  |
