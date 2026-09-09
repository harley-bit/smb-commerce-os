/**
 * `docs/cards/D148.md` — "Push notifications". Pure content builders, no
 * I/O — same posture as `transactionalNotifications.ts` (D134), but for the
 * push channel specifically rather than email.
 *
 * This card's security check ("no sensitive detail in notification
 * payloads"): a push notification is delivered through a third-party
 * transport (APNs/FCM) outside our own servers and is commonly rendered on
 * a device's lock screen, visible to anyone holding the phone — unlike the
 * email bodies `transactionalNotifications.ts` builds. So every builder
 * here deliberately omits money (`amountMinor`/`currency`/formatted totals)
 * and any raw internal id that isn't needed for the app's own deep-link
 * (`data.orderId`/`data.reservationId` are opaque routing values, never
 * rendered as visible text) — proven by `pushNotifications.test.ts`
 * asserting the visible `title`/`body` never contain the amount, currency,
 * or (for reminder/return-due) the raw reservation id.
 */

export type PushNotificationType =
  | "ORDER_CONFIRMATION"
  | "RESERVATION_REMINDER"
  | "RETURN_DUE"
  | "DEPOSIT_RELEASED";

export interface PushNotification {
  readonly type: PushNotificationType;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>>;
}

export interface OrderConfirmationPushInput {
  readonly orderId: string;
  readonly totalMinor: number;
  readonly currency: string;
}

export function buildOrderConfirmationPush(input: OrderConfirmationPushInput): PushNotification {
  return {
    type: "ORDER_CONFIRMATION",
    title: "Order confirmed",
    body: "Your order is confirmed. Tap to view your receipt.",
    data: { type: "ORDER_CONFIRMATION", orderId: input.orderId },
  };
}

export interface ReservationReminderPushInput {
  readonly reservationId: string;
  readonly subjectLabel: string;
  readonly startsAt: string;
}

export function buildReservationReminderPush(input: ReservationReminderPushInput): PushNotification {
  return {
    type: "RESERVATION_REMINDER",
    title: "Upcoming reservation",
    body: `Reminder: ${input.subjectLabel} is coming up.`,
    data: { type: "RESERVATION_REMINDER", reservationId: input.reservationId },
  };
}

export interface ReturnDuePushInput {
  readonly reservationId: string;
  readonly subjectLabel: string;
  readonly endsAt: string;
}

export function buildReturnDuePush(input: ReturnDuePushInput): PushNotification {
  return {
    type: "RETURN_DUE",
    title: "Return due soon",
    body: `${input.subjectLabel} is due for return soon.`,
    data: { type: "RETURN_DUE", reservationId: input.reservationId },
  };
}

export interface DepositReleasedPushInput {
  readonly orderId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export function buildDepositReleasedPush(input: DepositReleasedPushInput): PushNotification {
  return {
    type: "DEPOSIT_RELEASED",
    title: "Deposit released",
    body: "Your deposit hold has been released.",
    data: { type: "DEPOSIT_RELEASED", orderId: input.orderId },
  };
}
