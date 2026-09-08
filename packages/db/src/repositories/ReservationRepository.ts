import { generateUuidV7, type TenantContext } from "@smb-os/domain";
import { and, eq, gt, lt, or, type SQLWrapper } from "drizzle-orm";
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
  constructor(private readonly conn: Connection) {
    super(reservations.merchantId);
  }

  create: RepositoryMethod<[input: CreateReservationInput], string> = (ctx, input) => {
    return this.insertRow(ctx, input);
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
  createGuarded: RepositoryMethod<[input: CreateReservationInput, capacity?: number], string> = (
    ctx,
    input,
    capacity = 1,
  ) => {
    const attempt = this.conn.sqlite.transaction((): string => {
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

    return attempt.immediate();
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
