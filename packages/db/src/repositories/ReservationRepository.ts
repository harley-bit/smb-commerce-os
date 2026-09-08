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
