import {
  applyDamageClaimEvent,
  generateUuidV7,
  type DamageClaimEventType,
  type DamageClaimState,
} from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { damageClaims } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export interface DamageClaim {
  id: string;
  merchantId: string;
  orderLineId: string;
  amountMinor: number;
  state: DamageClaimState;
  filedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface CreateDamageClaimInput {
  orderLineId: string;
  amountMinor: number;
  state: DamageClaimState;
  filedAt: string;
}

export interface ResolveDamageClaimInput {
  state: DamageClaimState;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

/**
 * `docs/design/03` "Rental lifecycle" / `docs/cards/D076.md` — persistence
 * for `damage_claims`. `transition` mirrors `ReservationRepository`'s
 * `transition` (D071): it is the single write path every state change
 * routes through, reading the current row and handing its state plus the
 * requested event to `applyDamageClaimEvent` (`packages/domain`) rather than
 * ever setting `state` to an arbitrary value. There is no exported "setter"
 * — `notifyCustomer`, `dispute`, `resolveCaptured`, and `resolveWaived` are
 * thin wrappers naming one `DamageClaimEventType` each.
 */
export class DamageClaimRepository extends TenantScopedRepository<typeof damageClaims.merchantId> {
  constructor(private readonly conn: Connection) {
    super(damageClaims.merchantId);
  }

  /** Creates a claim already in the state supplied — callers construct the initial state via `applyDamageClaimEvent` (`DRAFT` + `FILE` → `FILED`). */
  create: RepositoryMethod<[input: CreateDamageClaimInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(damageClaims)
      .values({ id, merchantId: ctx.merchantId, resolvedAt: null, resolutionNote: null, ...input })
      .run();
    return id;
  };

  findById: RepositoryMethod<[id: string], DamageClaim | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(damageClaims)
      .where(and(this.scope(ctx), eq(damageClaims.id, id)))
      .get() as DamageClaim | undefined;
  };

  listByOrderLine: RepositoryMethod<[orderLineId: string], DamageClaim[]> = (ctx, orderLineId) => {
    return this.conn.db
      .select()
      .from(damageClaims)
      .where(and(this.scope(ctx), eq(damageClaims.orderLineId, orderLineId)))
      .all() as DamageClaim[];
  };

  /** Test/administrative escape hatch — production callers should route through `transition` via the named event wrappers below. */
  updateState: RepositoryMethod<[id: string, input: ResolveDamageClaimInput], void> = (ctx, id, input) => {
    const result = this.conn.db
      .update(damageClaims)
      .set(input)
      .where(and(this.scope(ctx), eq(damageClaims.id, id)))
      .run();
    if (result.changes === 0) {
      throw new Error(`Damage claim not found: ${id}`);
    }
  };

  private transition: RepositoryMethod<[id: string, eventType: DamageClaimEventType, extra?: Partial<ResolveDamageClaimInput>], void> = (
    ctx,
    id,
    eventType,
    extra,
  ) => {
    const row = this.findById(ctx, id);
    if (!row) {
      throw new Error(`Damage claim not found: ${id}`);
    }
    const nextState = applyDamageClaimEvent(row.state, { type: eventType });
    this.conn.db
      .update(damageClaims)
      .set({ state: nextState, ...extra })
      .where(and(this.scope(ctx), eq(damageClaims.id, id)))
      .run();
  };

  notifyCustomer: RepositoryMethod<[id: string], void> = (ctx, id) => {
    this.transition(ctx, id, "NOTIFY_CUSTOMER");
  };

  dispute: RepositoryMethod<[id: string], void> = (ctx, id) => {
    this.transition(ctx, id, "DISPUTE");
  };

  resolveCaptured: RepositoryMethod<[id: string, resolvedAt: string, resolutionNote: string | null], void> = (
    ctx,
    id,
    resolvedAt,
    resolutionNote,
  ) => {
    this.transition(ctx, id, "RESOLVE_CAPTURED", { resolvedAt, resolutionNote });
  };

  resolveWaived: RepositoryMethod<[id: string, resolvedAt: string, resolutionNote: string | null], void> = (
    ctx,
    id,
    resolvedAt,
    resolutionNote,
  ) => {
    this.transition(ctx, id, "RESOLVE_WAIVED", { resolvedAt, resolutionNote });
  };
}
