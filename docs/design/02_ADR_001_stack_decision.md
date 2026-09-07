# ADR-001 — Web and Mobile Codebase

**Status:** Proposed — requires founder ratification before Phase 0
**Date:** September 7, 2026
**Decision owner:** Founder

## First, a correction to the framing

The question was posed as "React or Node.js." These are not alternatives — they sit at different layers:

- **Node.js** is a server-side JavaScript runtime. It is a candidate for the **backend API**.
- **React** is a UI library. It is a candidate for the **web frontend**. **React Native** is a candidate for **mobile**.

A system can, and normally does, use both. The real decisions are three:

1. What language and framework runs the **backend API**?
2. What builds the **web frontend**?
3. What builds the **mobile app**?

This ADR answers all three together, because the strongest argument in play is about the relationship between them, not any one of them.

## Options considered

### Option A — TypeScript across the stack ✅ RECOMMENDED

| Layer | Choice |
|---|---|
| Backend API | Node.js + Fastify (TypeScript) |
| Database access | Drizzle ORM |
| Web | React via Next.js |
| Mobile | React Native via Expo |
| Shared | pnpm monorepo; shared types and Zod validation schemas |

### Option B — Python backend, React frontends

| Layer | Choice |
|---|---|
| Backend API | Python + FastAPI, SQLAlchemy, Alembic |
| Web | React via Next.js |
| Mobile | React Native via Expo |

### Option C — Full-stack Next.js

One Next.js application serving both UI and API routes, with Expo for mobile.

## Evaluation

| Criterion | A — TS everywhere | B — Python + React | C — Full-stack Next |
|---|---|---|---|
| One language across API, web, mobile | ✅ Yes | ❌ Two languages | ✅ Yes |
| **Shared validation schemas** | ✅ One Zod schema validates at API, web, and mobile | ❌ Duplicated in Python and TS | ✅ Yes |
| SQLite → PostgreSQL portability | ✅ Drizzle targets both | ✅ SQLAlchemy targets both | ✅ Drizzle |
| Support for PostgreSQL exclusion constraints | ⚠️ Raw SQL migration | ⚠️ Raw SQL migration | ⚠️ Raw SQL migration |
| Mobile from the same codebase | ✅ Expo | ✅ Expo | ✅ Expo |
| Clean API boundary for mobile and future partners | ✅ Separate service | ✅ Separate service | ❌ API coupled to web app |
| Security boundary clarity | ✅ Explicit | ✅ Explicit | ⚠️ Blurred — easy to leak server code into client bundles |
| Contract engineering availability | ✅ Largest pool | ⚠️ Split skill set | ✅ Large |
| Fit for scheduling/interval logic | ✅ Fine | ✅ Fine | ✅ Fine |
| Fit for future data/ML work | ⚠️ Weaker | ✅ Stronger | ⚠️ Weaker |
| Moving parts to operate | Medium | Medium-high | Lowest |

## Decision

**Option A — TypeScript across the stack.**

### Why

**Shared validation is a security control, not a convenience.** A single Zod schema defines a request shape once and is enforced at the API boundary, in the web form, and in the mobile client. In Option B the same rules are written twice in two languages, and the failure mode is silent divergence — a field the web validates and the API does not. For a security-first design, one definition of "valid input" is materially safer than two.

**A separate API service is the right boundary.** Option C is the fewest moving parts and the fastest to a demo, but it couples the API's lifecycle to the web application and makes mobile a second-class consumer of routes designed for a web page. It also blurs the server/client boundary in a way that regularly leaks server-side code or secrets into client bundles. Given that mobile is in scope and a partner or agent-facing API is plausible later, the boundary is worth its cost now.

**Drizzle over Prisma.** Both target SQLite and PostgreSQL. Drizzle is chosen because it is SQL-first, which matters specifically for `05`: the PostgreSQL production design relies on a GiST exclusion constraint to make double-booking impossible at the database level. Neither ORM models that natively — it requires a raw SQL migration either way — and Drizzle's closer-to-SQL posture makes such migrations and their SQLite equivalents easier to maintain side by side.

**Fastify over NestJS.** Less framework, faster, and the structure this application needs (a repository layer with enforced tenant scoping, a service layer holding invariants) is better expressed explicitly than through a framework's dependency-injection conventions. NestJS is defensible if a larger team is expected.

### What this costs

Python is the better choice if the platform later does serious data or machine-learning work — the eventual valuation and underwriting ideas in the reference material point that way. This is an accepted trade: that work, if it ever happens, is a separate service in a different language, called over an API. Choosing Python now for a possibility that is several years and one funding round away would be optimizing for the wrong decade.

## Stack, in full

| Concern | Choice |
|---|---|
| Language | TypeScript, strict mode, no implicit `any` |
| Runtime | Node.js LTS |
| API framework | Fastify |
| Validation | Zod, shared package |
| ORM / migrations | Drizzle + drizzle-kit, with raw SQL migrations for constraints |
| Database (local) | SQLite, WAL mode |
| Database (target) | PostgreSQL on AWS (`04`, `11`) |
| Web | Next.js (React) |
| Mobile | Expo (React Native) |
| Monorepo | pnpm workspaces + Turborepo |
| Testing | Vitest (unit, integration), Playwright (end-to-end) |
| Auth | Managed provider — decision D4, `07` |
| Payments | Stripe Connect, hosted fields only |
| Lint / format | ESLint + Prettier, enforced in CI |

## Repository layout

```
/apps
  /api          Fastify service — the only thing that touches the database
  /web          Next.js merchant dashboard + customer storefront
  /mobile       Expo customer app
/packages
  /domain       Entities, invariants, state machines — no I/O, no framework
  /db           Drizzle schema, migrations, repositories
  /contracts    Zod schemas + generated API client types
  /config       Shared lint, tsconfig, test config
/docs
  /adr          Architecture decision records
  /compliance   Control evidence and policies (09)
```

**The `/packages/domain` rule:** business invariants — availability conflict detection, the deposit state machine, inventory transitions — live here with no database or HTTP dependency. They are unit-testable without infrastructure, and they cannot be bypassed by a controller taking a shortcut.

## Consequences

- Every developer must be competent in TypeScript. There is no Python path in the codebase.
- Mobile and web share components only where genuinely shared; React Native and React DOM are not the same target and pretending otherwise creates worse code than duplicating a screen.
- The PostgreSQL exclusion constraint is a raw SQL migration with a documented SQLite counterpart (`05`). This divergence is deliberate, tested, and is the single most important portability risk to manage.

## Ratification

| Field | Value |
|---|---|
| Decision | ☑ Accepted |
| Date | 2026-09-07 |
| Notes | Accepted as proposed, no modifications. |
