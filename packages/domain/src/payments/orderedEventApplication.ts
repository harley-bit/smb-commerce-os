/**
 * `docs/design/06` "Webhook handling" — "Providers retry aggressively and
 * deliver out of order. Idempotency and ordering-tolerance are requirements,
 * not refinements." `docs/cards/D093.md` is the ordering-tolerance half
 * (D092 already covered idempotency via `WebhookEventRepository`).
 *
 * Pure domain math, no I/O — same shape as `depositStateMachine.ts`. A
 * webhook delivery's *arrival* order is not its *logical* order: Stripe's
 * own retry/fanout behavior can deliver an earlier event after a later one.
 * `applyOrderedEvent` folds a stream of provider events into a status by the
 * event's own `occurredAt` timestamp (Stripe's `created`), not call order —
 * an event that is not newer than the last one actually applied is a no-op,
 * so no matter what order a set of events is *handed to* this function, the
 * final state converges to whichever event is chronologically last.
 */

export interface OrderedEvent<TStatus> {
  readonly status: TStatus;
  readonly occurredAt: string;
}

export interface OrderedApplicationState<TStatus> {
  readonly status: TStatus;
  readonly lastAppliedAt: string | null;
}

export function applyOrderedEvent<TStatus>(
  current: OrderedApplicationState<TStatus>,
  incoming: OrderedEvent<TStatus>,
): OrderedApplicationState<TStatus> {
  if (current.lastAppliedAt !== null && incoming.occurredAt <= current.lastAppliedAt) {
    return current;
  }
  return { status: incoming.status, lastAppliedAt: incoming.occurredAt };
}
