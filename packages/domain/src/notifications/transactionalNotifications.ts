/**
 * `docs/cards/D134.md` — "Transactional notifications". Pure content
 * builders, no I/O — same shape as `depositDisclosure.ts`/`orderReceipt.ts`.
 * Each function turns already-server-recorded data into a subject/body pair;
 * delivery (email/SMS/push) is out of scope, same as every other notifier in
 * this codebase (D069/D076/D094/D120/D131) — callers fire an injected,
 * default-no-op callback with the built content.
 *
 * This card's security check ("transactional only — no marketing, so no
 * consent management"): every notification here is triggered by the
 * customer's own action (placing an order) or by the state of their own
 * order/reservation/deposit (a reminder, a due date, a release) — never by
 * a merchant-initiated campaign — so none of it is marketing communication
 * requiring opt-in/opt-out consent tracking (unlike `checkout_consents`/
 * `deposit_consents`, which exist for a different reason: evidencing terms
 * agreement, not marketing consent).
 */

export type TransactionalNotificationType =
  | "ORDER_CONFIRMATION"
  | "RESERVATION_REMINDER"
  | "RETURN_DUE"
  | "DEPOSIT_RELEASED";

export interface TransactionalNotification {
  readonly type: TransactionalNotificationType;
  readonly subject: string;
  readonly body: string;
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

export interface OrderConfirmationNotificationInput {
  readonly orderId: string;
  readonly totalMinor: number;
  readonly currency: string;
}

export function buildOrderConfirmationNotification(
  input: OrderConfirmationNotificationInput,
): TransactionalNotification {
  return {
    type: "ORDER_CONFIRMATION",
    subject: `Your order is confirmed`,
    body: `Order ${input.orderId} is confirmed. Total charged: ${formatMinor(input.totalMinor, input.currency)}.`,
  };
}

export interface ReservationReminderNotificationInput {
  readonly subjectLabel: string;
  readonly startsAt: string;
}

export function buildReservationReminderNotification(
  input: ReservationReminderNotificationInput,
): TransactionalNotification {
  return {
    type: "RESERVATION_REMINDER",
    subject: `Reminder: ${input.subjectLabel} coming up`,
    body: `This is a reminder that ${input.subjectLabel} is scheduled to start at ${input.startsAt}.`,
  };
}

export interface ReturnDueNotificationInput {
  readonly subjectLabel: string;
  readonly endsAt: string;
}

export function buildReturnDueNotification(input: ReturnDueNotificationInput): TransactionalNotification {
  return {
    type: "RETURN_DUE",
    subject: `Return due soon: ${input.subjectLabel}`,
    body: `${input.subjectLabel} is due for return by ${input.endsAt}.`,
  };
}

export interface DepositReleasedNotificationInput {
  readonly amountMinor: number;
  readonly currency: string;
}

export function buildDepositReleasedNotification(
  input: DepositReleasedNotificationInput,
): TransactionalNotification {
  return {
    type: "DEPOSIT_RELEASED",
    subject: `Your deposit has been released`,
    body: `Your deposit hold of ${formatMinor(input.amountMinor, input.currency)} has been released back to your card.`,
  };
}
