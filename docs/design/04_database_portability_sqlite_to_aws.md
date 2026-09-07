# Database Portability — SQLite Now, AWS PostgreSQL Later

## Decision

**Develop on SQLite. Target PostgreSQL on AWS.** Both are supported from day one by the same schema definition and the same repository code, with a small, explicitly managed set of divergences.

This is a real constraint, not a formality. Most "we'll port later" plans fail because the application quietly grows dependencies on the development database's behaviour. The rules below exist to prevent that, and the parity test suite exists to prove it.

## Why SQLite is a good development choice here

- Zero setup — no container, no service, no credentials on a developer machine.
- Tests run against a real database, in-memory, in milliseconds. This makes the invariant test suite (`10`) fast enough to run on every save.
- **Single-writer serialization is a correctness advantage at MVP scale.** SQLite in WAL mode allows concurrent readers and exactly one writer. A read-check-write reservation transaction is therefore atomic by construction (`05`), with no application-level locking.

## Why PostgreSQL is the target

- `EXCLUDE USING gist` makes overlapping reservations **impossible at the database level** — the single most valuable correctness guarantee available to this system.
- Row-level security enables defence-in-depth on tenant isolation.
- Concurrent writers, connection pooling, and replicas at scale.
- Native `timestamptz`, `uuid`, `jsonb`, and range types.

## Portability rules

Violating any of these is a CI failure, not a code review comment.

| # | Rule | Why |
|---|---|---|
| P1 | **No raw SQL outside `/packages/db`.** All access through Drizzle or a repository method | One place to audit for dialect leakage |
| P2 | **No SQLite-only functions** in application code | `strftime`, `julianday` have no PG equivalent |
| P3 | **No PostgreSQL-only features** in shared code paths — dialect-specific behaviour lives behind a repository method with two implementations | The exclusion constraint is the only sanctioned divergence |
| P4 | **UUIDs generated in application code**, never by the database | `gen_random_uuid()` does not exist in SQLite |
| P5 | **Timestamps written as UTC ISO-8601 strings**; comparison is lexicographic and therefore correct in both | SQLite has no date type |
| P6 | **Money is `INTEGER` minor units** | SQLite has no `NUMERIC` with real precision; floats are unacceptable for money |
| P7 | **Booleans as `INTEGER` 0/1**, mapped in the ORM layer | SQLite has no boolean type |
| P8 | **No stored procedures, no triggers, no database-level defaults** beyond constants | Not portable; hides logic from tests |
| P9 | **Foreign keys enforced** — `PRAGMA foreign_keys = ON` on every SQLite connection | Off by default in SQLite; a silent divergence from PG |
| P10 | **JSON stored as `TEXT` (SQLite) / `jsonb` (PG)**, always serialized and parsed in application code | No querying inside JSON columns in the MVP |

## Type mapping

| Domain | SQLite | PostgreSQL |
|---|---|---|
| Identifier | `TEXT` (UUIDv7) | `uuid` |
| Money | `INTEGER` (minor units) | `bigint` |
| Timestamp | `TEXT` ISO-8601 UTC | `timestamptz` |
| Date | `TEXT` `YYYY-MM-DD` | `date` |
| Time of day | `TEXT` `HH:MM` | `time` |
| Boolean | `INTEGER` 0/1 | `boolean` |
| Enum | `TEXT` + CHECK constraint | `TEXT` + CHECK constraint |
| JSON | `TEXT` | `jsonb` |
| Interval | Two columns | Two columns, plus a generated `tstzrange` for the constraint |

**Enums are `TEXT` with a CHECK constraint in both**, deliberately. PostgreSQL native enums require a migration to add a value and do not exist in SQLite; a CHECK constraint is portable and easy to evolve.

## The one sanctioned divergence — reservation overlap

This is the only place where the two databases do genuinely different things, and it is documented, tested, and isolated in a single repository method.

**PostgreSQL** — the constraint makes the bug impossible:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservations
  ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (
    subject_type WITH =,
    subject_id   WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (state IN ('HELD','CONFIRMED','IN_USE'));
```

**SQLite** — no exclusion constraints exist. The equivalent guarantee comes from serialization:

```
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

BEGIN IMMEDIATE;
  SELECT 1 FROM reservations
   WHERE subject_type = ? AND subject_id = ?
     AND state IN ('HELD','CONFIRMED','IN_USE')
     AND starts_at < ? AND ends_at > ?;     -- half-open overlap
  -- if a row exists, abort
  INSERT INTO reservations (...) VALUES (...);
COMMIT;
```

`BEGIN IMMEDIATE` takes the write lock at transaction start rather than at first write, which is what makes the check-then-insert atomic. Without it, two transactions can both read "no conflict" and both insert.

**Both paths are covered by the same concurrency test** (`05`), which fires simultaneous reservations at the same slot and asserts exactly one succeeds. The test runs against both dialects in CI. If the SQLite path regresses, the test fails on SQLite; if the PostgreSQL constraint is dropped by a bad migration, it fails on PostgreSQL.

## Migration strategy

- **drizzle-kit** generates migrations; a matching pair is maintained for each dialect where they differ.
- Migrations are **forward-only**. No down migrations in production; a bad migration is fixed by a new migration.
- Every migration is reviewed for portability against P1–P10 before merge.
- Migrations run in CI against **both** dialects on every pull request. A migration that applies to SQLite but not PostgreSQL fails the build the day it is written, not months later.

## The cutover

Cutover happens when the pilot demands it — concurrent merchants, backups, or a hosted environment — not on a date.

1. Provision PostgreSQL on AWS (`11`).
2. Run the full migration chain against an empty PostgreSQL instance.
3. Apply the exclusion constraint migration.
4. Run the complete test suite against PostgreSQL. It must pass unchanged — this is the whole point of P1–P10.
5. Export SQLite data and import, converting types per the mapping table.
6. **Verify the exclusion constraint against real data.** If overlapping reservations exist in the SQLite data, the constraint will refuse to build — which is exactly the signal wanted, and the reason to cut over early rather than late.
7. Run in parallel read-only against production traffic before switching writes.

## Backup and recovery

**SQLite (development and single-merchant pilot):** `VACUUM INTO` a timestamped file on a schedule; the file is the backup. Restore is a file copy. Rehearse it in Phase 10 — an untested restore is not a backup.

**PostgreSQL (production):** automated snapshots plus point-in-time recovery, encrypted at rest with KMS, retention set per `08`. Restore rehearsed quarterly.

## What is deliberately not done

No database abstraction layer beyond the repository pattern. No attempt to support MySQL or any third database. No use of PostgreSQL features in the MVP beyond the exclusion constraint and, later, row-level security. Each additional dialect-specific feature is a portability liability, and the ones adopted here earn their place by eliminating an entire class of bug.
