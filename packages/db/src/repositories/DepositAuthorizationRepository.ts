import {
  applyDepositEvent,
  generateUuidV7,
  type DepositEvent,
  type DepositState,
} from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { depositAuthorizations } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export interface DepositAuthorization {
  id: string;
  merchantId: string;
  orderLineId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  state: DepositState;
  authorizedAt: string;
  expiresAt: string;
  capturedMinor: number | null;
  releasedAt: string | null;
}

export interface CreateDepositAuthorizationInput {
  orderLineId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  authorizedAt: string;
  expiresAt: string;
}

/**
 * `docs/design/03` "Payments and deposits" / `docs/cards/D078.md` —
 * persistence for `deposit_authorizations`. Mirrors `DamageClaimRepository`
 * (D076): `transition` is the single write path every state change routes
 * through, reading the current row and handing its state plus the requested
 * event to `applyDepositEvent` (`packages/domain`, D077) rather than ever
 * setting `state` to an arbitrary value.
 *
 * `capture` is this card's "single-capture and bounds" deliverable made
 * structural at the persistence layer: `applyDepositEvent` rejects a
 * `CAPTURE` above `row.amountMinor` (`docs/design/07`'s "capture amount
 * bounded by the authorized amount"), and once a first capture resolves the
 * row to a terminal state (`CAPTURED`/`PARTIALLY_CAPTURED`), any further
 * `capture` call re-reads that terminal state and throws — there is no
 * window where a second capture attempt can reach the database write.
 */
export class DepositAuthorizationRepository extends TenantScopedRepository<typeof depositAuthorizations.merchantId> {
  constructor(private readonly conn: Connection) {
    super(depositAuthorizations.merchantId);
  }

  create: RepositoryMethod<[input: CreateDepositAuthorizationInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(depositAuthorizations)
      .values({
        id,
        merchantId: ctx.merchantId,
        state: "AUTHORIZED",
        capturedMinor: null,
        releasedAt: null,
        ...input,
      })
      .run();
    return id;
  };

  findById: RepositoryMethod<[id: string], DepositAuthorization | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(depositAuthorizations)
      .where(and(this.scope(ctx), eq(depositAuthorizations.id, id)))
      .get() as DepositAuthorization | undefined;
  };

  private transition: RepositoryMethod<
    [id: string, event: DepositEvent, extra?: Partial<Pick<DepositAuthorization, "capturedMinor" | "releasedAt">>],
    DepositState
  > = (ctx, id, event, extra) => {
    const row = this.findById(ctx, id);
    if (!row) {
      throw new Error(`Deposit authorization not found: ${id}`);
    }
    const nextState = applyDepositEvent(row.state, event, { authorizedMinor: row.amountMinor });
    this.conn.db
      .update(depositAuthorizations)
      .set({ state: nextState, ...extra })
      .where(and(this.scope(ctx), eq(depositAuthorizations.id, id)))
      .run();
    return nextState;
  };

  /** One capture attempt; amount bounded by the authorized amount (`docs/cards/D078.md`). */
  capture: RepositoryMethod<[id: string, amountMinor: number], DepositState> = (ctx, id, amountMinor) => {
    return this.transition(ctx, id, { type: "CAPTURE", amountMinor }, { capturedMinor: amountMinor });
  };

  release: RepositoryMethod<[id: string, releasedAt: string], DepositState> = (ctx, id, releasedAt) => {
    return this.transition(ctx, id, { type: "RELEASE" }, { releasedAt });
  };

  expire: RepositoryMethod<[id: string], void> = (ctx, id) => {
    this.transition(ctx, id, { type: "EXPIRE" });
  };
}
