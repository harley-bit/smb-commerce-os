/**
 * `docs/cards/D095.md` security check — "single capture enforced at both
 * domain and provider layers." `depositStateMachine.ts`'s
 * `IllegalDepositTransitionError` is the domain-layer half (D077/D078); this
 * is the provider-layer half — a `DepositHoldProvider` implementation throws
 * this when asked to capture or release a hold whose `intentId` it has
 * already resolved one way (captured or released), independent of whatever
 * state `deposit_authorizations` itself is in. Two independent checks close
 * off `docs/design/14`'s T3 ("deposit state corruption") from both sides of
 * the seam: a bug in one layer's enforcement cannot alone let a double
 * capture through.
 */
export class DepositHoldAlreadyResolvedError extends Error {
  constructor(
    public readonly intentId: string,
    public readonly resolution: "CAPTURED" | "RELEASED",
  ) {
    super(`Deposit hold ${intentId} was already resolved (${resolution}) and cannot be captured or released again`);
    this.name = "DepositHoldAlreadyResolvedError";
  }
}
