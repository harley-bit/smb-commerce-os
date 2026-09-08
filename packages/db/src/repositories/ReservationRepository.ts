import {
  applyReservationEvent,
  expandIntervalForBuffer,
  generateUuidV7,
  type TenantContext,
} from "@smb-os/domain";
import { and, count as sqlCount, eq, gt, lt, or, type SQLWrapper } from "drizzle-orm";
import type { AvailabilityCache } from "../cache/AvailabilityCache.js";
import type { Connection } from "../connection.js";
import { reservations } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type ReservationSubjectType = "RESOURCE" | "INVENTORY_UNIT";
export type ReservationState = "HELD" | "CONFIRMED" | "IN_USE" | "COMPLETED" | "CANCELLED" | "EXPIRED";

export interface Reservation {
  id: string;
  merchantId: string;
  orderLineId: string | null;
  subjectType: ReservationSubjectType;
  subjectId: string;
  startsAt: string;
  endsAt: string;
  quantity: number;
  state: ReservationState;
  expiresAt: string | null;
  createdAt: string;
  releasedAt: string | null;
  idempotencyKey: string | null;
  createdByAccountId: string | null;
  createdByIp: string | null;
  bufferMinutes: number | null;
}

export interface CreateReservationInput {
  orderLineId?: string;
  subjectType: ReservationSubjectType;
  subjectId: string;
  startsAt: string;
  endsAt: string;
  quantity: number;
  state: ReservationState;
  expiresAt?: string;
  createdAt: string;
  /** `docs/cards/D059.md` security check — see `createGuarded`'s idempotent-replay behavior. */
  idempotencyKey?: string;
  /** `docs/cards/D062.md` — who/what asked for this hold, for the concurrent-hold caps. */
  createdByAccountId?: string;
  createdByIp?: string;
  /**
   * `docs/design/05` "Turnaround buffer" / `docs/cards/D064.md` — the
   * rental variant's `buffer_minutes` at the moment this reservation is
   * created. `endsAt` above is the *requested* end; `createGuarded`/`create`
   * expand it by this amount before it is stored, and store this raw value
   * alongside it, so a later change to the variant's buffer never
   * retroactively alters this row.
   */
  bufferMinutes?: number | null;
}

/**
 * `docs/design/05` "Turnaround buffer" / `docs/cards/D064.md` — expands the
 * *requested* `endsAt` by `bufferMinutes` before it is used for the overlap
 * check or persisted, and normalizes `bufferMinutes` itself to a concrete
 * `null` (rather than `undefined`) so it is always written to the row. Both
 * `create` and `createGuarded` route through this so the expanded interval
 * is what every blocking check and every stored row ever sees — there is no
 * code path that stores the unbuffered `endsAt`.
 */
function applyBufferExpansion(input: CreateReservationInput): CreateReservationInput {
  const { startsAt, endsAt } = expandIntervalForBuffer(input.startsAt, input.endsAt, input.bufferMinutes);
  return { ...input, startsAt, endsAt, bufferMinutes: input.bufferMinutes ?? null };
}

/** Thrown by `createGuarded` when the requested interval overlaps an existing blocking reservation. */
export class ReservationConflictError extends Error {
  constructor(
    public readonly subjectType: ReservationSubjectType,
    public readonly subjectId: string,
  ) {
    super(`Reservation conflict: ${subjectType} ${subjectId} already has an overlapping blocking reservation`);
    this.name = "ReservationConflictError";
  }
}

/**
 * `docs/design/05` — the only states that participate in overlap checks.
 * A `HELD` row additionally requires `expiresAt > asOf`: an unswept expired
 * hold is still in state `HELD` but must not block (this card's security
 * check — the sweeper flipping state to `EXPIRED` is a separate, later
 * process, not something callers can rely on having already run).
 */
function blockingStatePredicate(asOf: string): SQLWrapper {
  return or(
    eq(reservations.state, "CONFIRMED"),
    eq(reservations.state, "IN_USE"),
    and(eq(reservations.state, "HELD"), gt(reservations.expiresAt, asOf)),
  ) as SQLWrapper;
}

/**
 * `reservations.merchant_id` scopes every query, per `docs/design/07`
 * Control #1. `findBlocking` is the overlap query the availability engine
 * (`computeFreeIntervals`, D048) needs: standard interval overlap
 * (`starts_at < rangeEnd AND ends_at > rangeStart`) narrowed to one
 * merchant/subject pair, driven entirely off `reservations_subject_interval_idx`
 * (`merchant_id, subject_type, subject_id, starts_at, ends_at`).
 */
export class ReservationRepository extends TenantScopedRepository<typeof reservations.merchantId> {
  /**
   * `cache` is optional — every existing caller (tests, `BookingService`
   * without an availability cache wired up) keeps working unchanged;
   * `docs/cards/D060.md`'s acceptance criterion ("cache invalidated on any
   * reservation write for that subject") only fires when a real
   * `AvailabilityCache` is supplied.
   */
  constructor(
    private readonly conn: Connection,
    private readonly cache?: AvailabilityCache,
  ) {
    super(reservations.merchantId);
  }

  create: RepositoryMethod<[input: CreateReservationInput], string> = (ctx, input) => {
    const id = this.insertRow(ctx, applyBufferExpansion(input));
    this.cache?.invalidateSubject(ctx.merchantId, input.subjectId);
    return id;
  };

  /**
   * `docs/design/05` C1 / `docs/cards/D050.md` — the real write path for
   * creating a blocking reservation. `sqlite.transaction(...).immediate()`
   * opens with `BEGIN IMMEDIATE`, taking the write lock *before* the overlap
   * check runs, so a second concurrent caller cannot begin its own write
   * transaction until the first commits — it is therefore guaranteed to see
   * the first caller's committed row, never a stale pre-commit view. This is
   * the property a deferred transaction cannot provide (see
   * `ReservationRepository.write-path.test.ts`): under `journal_mode = WAL`,
   * a deferred transaction that already read stale data doesn't silently
   * double-book, but it does fail with an opaque, untyped
   * `SQLITE_BUSY_SNAPSHOT` rather than this method's typed, deterministic
   * `ReservationConflictError`.
   *
   * `capacity` (`docs/design/05` "Fungible capacity", `docs/cards/D054.md`)
   * defaults to 1 — a serialized subject (rental `INVENTORY_UNIT`, or a
   * `RESOURCE` with `capacity: 1`), where any existing blocking reservation
   * always conflicts, exactly D050's original behavior. For a `RESOURCE`
   * with `capacity > 1` (a class with several seats), the check instead sums
   * `quantity` across overlapping blocking reservations and only conflicts
   * once admitting this request would exceed capacity — `BEGIN IMMEDIATE`
   * is what makes this sum safe to trust: no other writer's blocking
   * reservation for this subject can commit between the sum and the insert.
   */
  /**
   * `docs/cards/D059.md` security check — Idempotency-Key required on
   * creation. When `input.idempotencyKey` is set, a retry carrying the same
   * key short-circuits to the already-created row instead of re-running the
   * conflict check: the lookup and the insert both happen inside this same
   * `BEGIN IMMEDIATE` transaction, so a retry racing the original request for
   * the same subject is serialized behind it exactly the way a genuine
   * conflict would be, and finds the row already committed. `capacity`'s
   * unique index (`reservations_merchant_idempotency_key_unique`) is the
   * belt-and-braces backstop for any caller that reuses a key across
   * different subjects — that still resolves as a thrown DB error, not a
   * silent double-booking, since this method never lets two rows share a key.
   */
  createGuarded: RepositoryMethod<[input: CreateReservationInput, capacity?: number], string> = (
    ctx,
    rawInput,
    capacity = 1,
  ) => {
    const input = applyBufferExpansion(rawInput);
    const attempt = this.conn.sqlite.transaction((): string => {
      if (input.idempotencyKey) {
        const existing = this.findByIdempotencyKey(ctx, input.idempotencyKey);
        if (existing) {
          return existing.id;
        }
      }

      const blocking = this.findBlocking(
        ctx,
        input.subjectType,
        input.subjectId,
        input.startsAt,
        input.endsAt,
        input.createdAt,
      );
      const usedQuantity = blocking.reduce((sum, reservation) => sum + reservation.quantity, 0);
      if (usedQuantity + input.quantity > capacity) {
        throw new ReservationConflictError(input.subjectType, input.subjectId);
      }
      return this.insertRow(ctx, input);
    });

    const id = attempt.immediate();
    this.cache?.invalidateSubject(ctx.merchantId, input.subjectId);
    return id;
  };

  findByIdempotencyKey: RepositoryMethod<[idempotencyKey: string], Reservation | undefined> = (
    ctx,
    idempotencyKey,
  ) => {
    return this.conn.db
      .select()
      .from(reservations)
      .where(and(this.scope(ctx), eq(reservations.idempotencyKey, idempotencyKey)))
      .get() as Reservation | undefined;
  };

  findById: RepositoryMethod<[id: string], Reservation | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(reservations)
      .where(and(this.scope(ctx), eq(reservations.id, id)))
      .get() as Reservation | undefined;
  };

  /**
   * `docs/cards/D059.md` deliverable — the HELD → CONFIRMED transition.
   * Routes through `applyReservationEvent` (`packages/domain`) rather than
   * writing `state` directly, so an illegal transition (already CONFIRMED,
   * EXPIRED, etc.) throws `IllegalReservationTransitionError` instead of
   * silently overwriting a terminal or already-advanced state.
   */
  confirm: RepositoryMethod<[id: string], void> = (ctx, id) => {
    let subjectId = "";
    const attempt = this.conn.sqlite.transaction((): void => {
      const row = this.findById(ctx, id);
      if (!row) {
        throw new Error(`Reservation not found: ${id}`);
      }
      subjectId = row.subjectId;
      const nextState = applyReservationEvent(row.state, { type: "CONFIRM" });
      this.conn.db
        .update(reservations)
        .set({ state: nextState })
        .where(and(this.scope(ctx), eq(reservations.id, id)))
        .run();
    });

    attempt.immediate();
    this.cache?.invalidateSubject(ctx.merchantId, subjectId);
  };

  private insertRow(ctx: TenantContext, input: CreateReservationInput): string {
    const id = generateUuidV7();
    this.conn.db
      .insert(reservations)
      .values({
        id,
        merchantId: ctx.merchantId,
        orderLineId: null,
        expiresAt: null,
        releasedAt: null,
        ...input,
      })
      .run();
    return id;
  }

  /**
   * `docs/cards/D062.md` — the per-account concurrent-hold cap
   * (`docs/design/07`/`14` T10). Same lazy-expiry predicate as
   * `findBlocking`/`blockingStatePredicate`'s HELD branch: an unswept
   * expired hold never counts against the cap, so the cap self-heals
   * without needing the sweeper to have run first.
   */
  countActiveHoldsByAccount: RepositoryMethod<[accountId: string, asOf: string], number> = (
    ctx,
    accountId,
    asOf,
  ) => {
    const row = this.conn.db
      .select({ count: sqlCount() })
      .from(reservations)
      .where(
        and(
          this.scope(ctx),
          eq(reservations.createdByAccountId, accountId),
          eq(reservations.state, "HELD"),
          gt(reservations.expiresAt, asOf),
        ),
      )
      .get() as { count: number };
    return row.count;
  };

  /** `docs/cards/D062.md` — the per-IP cap, stricter for anonymous carts (no account id at all). */
  countActiveHoldsByIp: RepositoryMethod<[ip: string, asOf: string], number> = (ctx, ip, asOf) => {
    const row = this.conn.db
      .select({ count: sqlCount() })
      .from(reservations)
      .where(
        and(
          this.scope(ctx),
          eq(reservations.createdByIp, ip),
          eq(reservations.state, "HELD"),
          gt(reservations.expiresAt, asOf),
        ),
      )
      .get() as { count: number };
    return row.count;
  };

  findBlocking: RepositoryMethod<
    [
      subjectType: ReservationSubjectType,
      subjectId: string,
      rangeStart: string,
      rangeEnd: string,
      asOf: string,
    ],
    Reservation[]
  > = (ctx, subjectType, subjectId, rangeStart, rangeEnd, asOf) => {
    return this.conn.db
      .select()
      .from(reservations)
      .where(
        and(
          this.scope(ctx),
          eq(reservations.subjectType, subjectType),
          eq(reservations.subjectId, subjectId),
          lt(reservations.startsAt, rangeEnd),
          gt(reservations.endsAt, rangeStart),
          blockingStatePredicate(asOf),
        ),
      )
      .all() as Reservation[];
  };

  /**
   * Same predicate as `findBlocking`, run through `EXPLAIN QUERY PLAN` so
   * the index usage is testable. Declared as a regular method rather than
   * a `RepositoryMethod` class property (arrow-function field) since it's
   * query-plan test scaffolding, not a tenant-data-access path — Gate G1's
   * isolation-coverage scan (D021) only walks arrow-function properties.
   */
  explainFindBlocking(
    ctx: TenantContext,
    subjectType: ReservationSubjectType,
    subjectId: string,
    rangeStart: string,
    rangeEnd: string,
    asOf: string,
  ): { detail: string }[] {
    const query = this.conn.db
      .select()
      .from(reservations)
      .where(
        and(
          this.scope(ctx),
          eq(reservations.subjectType, subjectType),
          eq(reservations.subjectId, subjectId),
          lt(reservations.startsAt, rangeEnd),
          gt(reservations.endsAt, rangeStart),
          blockingStatePredicate(asOf),
        ),
      );

    const { sql, params } = query.toSQL();
    return this.conn.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
  }
}
