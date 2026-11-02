import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ReservationConflictError, ReservationRepository } from "./ReservationRepository.js";

/**
 * `docs/design/05` C1/`docs/cards/D050.md`: this file proves the load-bearing
 * claim directly, using two real `better-sqlite3` connections against the
 * same on-disk file with statements interleaved by hand — SQLite's actual
 * locking behavior is under test, not JS's event loop.
 *
 * With `journal_mode = WAL` (mandatory per `docs/design/04`, set on every
 * connection since D013), a `BEGIN DEFERRED` transaction that has already
 * read does *not* silently let a stale write through the way classic
 * rollback-journal SQLite would — WAL's snapshot isolation detects that the
 * database changed since the read and refuses the write. But that refusal
 * is `SQLITE_BUSY_SNAPSHOT`, a generic, untyped, unretriable engine error —
 * not the application's own conflict detection. The caller has no way to
 * distinguish "someone booked this same slot" from "the database is briefly
 * contended for an unrelated reason," and which of the two writers gets the
 * error is an accident of statement ordering, not a designed guarantee.
 * That is what "the deferred variant demonstrably fails" means here: it
 * fails to give the application a clean, typed, deterministic answer.
 * `BEGIN IMMEDIATE` (the real `createGuarded` write path below) fixes both
 * problems at once — it blocks at `BEGIN`, before any read, so the second
 * writer's overlap check always runs against post-commit data and yields a
 * real, catchable `ReservationConflictError` every time.
 */
describe("ReservationRepository — SQLite write path (D050)", () => {
  let dir: string;
  let dbFile: string;
  let connA: Connection;
  let connB: Connection;
  let merchantId: string;
  let resourceId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "d050-write-path-"));
    dbFile = join(dir, "test.db");

    connA = createConnection(dbFile);
    await runSqliteMigrations(connA);
    connB = createConnection(dbFile);

    merchantId = generateUuidV7();
    resourceId = generateUuidV7();
    const locationId = generateUuidV7();

    await connA.db.insert(sqliteSchema.merchants).values({
      id: merchantId,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    await connA.db.insert(sqliteSchema.locations).values({
      id: locationId,
      merchantId,
      name: "Main",
      timezone: "UTC",
    });
    await connA.db.insert(sqliteSchema.resources).values({
      id: resourceId,
      merchantId,
      locationId,
      kind: "STAFF",
      name: "Jane",
      capacity: 1,
    });
  });

  afterEach(() => {
    connA.sqlite.close();
    connB.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a deferred-transaction check-then-insert demonstrably fails under the exact interleaving that must be handled (opaque SQLITE_BUSY_SNAPSHOT, not a clean conflict rejection)", () => {
    const ctx = createTenantContext(merchantId);
    const repoA = new ReservationRepository(connA);
    const repoB = new ReservationRepository(connB);

    const startsAt = "2026-10-01T09:00:00.000Z";
    const endsAt = "2026-10-01T10:00:00.000Z";
    const asOf = "2026-10-01T08:45:00.000Z";

    // Writer A opens a DEFERRED transaction and checks for a conflict —
    // none exists yet, since B hasn't written anything.
    connA.sqlite.prepare("BEGIN DEFERRED").run();
    const blockingSeenByA = repoA.findBlocking(ctx, "RESOURCE", resourceId, startsAt, endsAt, asOf);
    expect(blockingSeenByA).toEqual([]);

    // Writer B opens its own DEFERRED transaction and checks too — a
    // deferred transaction takes no lock until its first write, so B's
    // read is not blocked by A's still-open, still-read-only transaction.
    // B also sees no conflict, because A hasn't inserted anything yet.
    // This establishes B's read snapshot as of *before* A's write.
    connB.sqlite.prepare("BEGIN DEFERRED").run();
    const blockingSeenByB = repoB.findBlocking(ctx, "RESOURCE", resourceId, startsAt, endsAt, asOf);
    expect(blockingSeenByB).toEqual([]);

    // A finishes its booking and commits.
    const idA = generateUuidV7();
    connA.db
      .insert(sqliteSchema.reservations)
      .values({
        id: idA,
        merchantId,
        orderLineId: null,
        subjectType: "RESOURCE",
        subjectId: resourceId,
        startsAt,
        endsAt,
        quantity: 1,
        state: "CONFIRMED",
        expiresAt: null,
        createdAt: asOf,
        releasedAt: null,
      })
      .run();
    connA.sqlite.prepare("COMMIT").run();

    // B, believing (from its now-stale read) that the slot was free,
    // attempts to write its own overlapping reservation. This is the
    // deferred variant's failure: not a silent double-booking (WAL's
    // snapshot isolation happens to prevent that specific outcome), but an
    // opaque low-level engine error that carries no business meaning and
    // that a caller cannot tell apart from ordinary transient contention.
    let caught: unknown;
    try {
      connB.db
        .insert(sqliteSchema.reservations)
        .values({
          id: generateUuidV7(),
          merchantId,
          orderLineId: null,
          subjectType: "RESOURCE",
          subjectId: resourceId,
          startsAt,
          endsAt,
          quantity: 1,
          state: "CONFIRMED",
          expiresAt: null,
          createdAt: asOf,
          releasedAt: null,
        })
        .run();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ReservationConflictError);
    expect((caught as { code?: string }).code).toBe("SQLITE_BUSY_SNAPSHOT");
    connB.sqlite.prepare("ROLLBACK").run();

    // Only A's reservation ever landed — but B was never told "conflict",
    // it was told "database is locked", which is not an answer a booking
    // flow can act on (retry forever? tell the customer it worked?).
    const finalRows = repoA.findBlocking(ctx, "RESOURCE", resourceId, startsAt, endsAt, asOf);
    expect(finalRows.map((r) => r.id)).toEqual([idA]);
  });

  it("createGuarded()'s BEGIN IMMEDIATE serializes the same interleaving so the second writer sees the first writer's commit and is rejected", () => {
    const ctx = createTenantContext(merchantId);
    const repoA = new ReservationRepository(connA);
    const repoB = new ReservationRepository(connB);

    const startsAt = "2026-10-01T09:00:00.000Z";
    const endsAt = "2026-10-01T10:00:00.000Z";
    const asOf = "2026-10-01T08:45:00.000Z";

    // A short busy_timeout on B keeps this test fast: with BEGIN IMMEDIATE,
    // B's attempt to acquire the write lock while A still holds it must
    // either wait for A to release it or fail — it must never silently
    // proceed as if uncontended, which is exactly what the deferred variant
    // above allowed.
    connB.sqlite.pragma("busy_timeout = 200");

    // Writer A acquires the write lock immediately, at BEGIN, before its
    // read even runs — the load-bearing difference from the deferred case.
    connA.sqlite.prepare("BEGIN IMMEDIATE").run();
    const blockingSeenByA = repoA.findBlocking(ctx, "RESOURCE", resourceId, startsAt, endsAt, asOf);
    expect(blockingSeenByA).toEqual([]);

    // While A's write transaction is still open, B cannot even begin its
    // own IMMEDIATE transaction — it is not allowed to read-then-write
    // concurrently with A the way the deferred variant permitted.
    expect(() => connB.sqlite.prepare("BEGIN IMMEDIATE").run()).toThrow(/database is locked/);

    // A finishes its booking and commits, releasing the write lock.
    const idA = generateUuidV7();
    connA.db
      .insert(sqliteSchema.reservations)
      .values({
        id: idA,
        merchantId,
        orderLineId: null,
        subjectType: "RESOURCE",
        subjectId: resourceId,
        startsAt,
        endsAt,
        quantity: 1,
        state: "CONFIRMED",
        expiresAt: null,
        createdAt: asOf,
        releasedAt: null,
      })
      .run();
    connA.sqlite.prepare("COMMIT").run();

    // Now B retries through the real production path — `createGuarded` —
    // and, because it can only ever observe the post-commit state, correctly
    // detects A's reservation and rejects rather than double-booking.
    expect(() =>
      repoB.createGuarded(ctx, {
        subjectType: "RESOURCE",
        subjectId: resourceId,
        startsAt,
        endsAt,
        quantity: 1,
        state: "CONFIRMED",
        createdAt: asOf,
      }),
    ).toThrow(ReservationConflictError);

    const finalRows = repoA.findBlocking(ctx, "RESOURCE", resourceId, startsAt, endsAt, asOf);
    expect(finalRows.map((r) => r.id)).toEqual([idA]);
  });
});
