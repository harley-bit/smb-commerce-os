import { describe, expect, it } from "vitest";
import {
  buildDepositReleasedPush,
  buildOrderConfirmationPush,
  buildReservationReminderPush,
  buildReturnDuePush,
} from "./pushNotifications.js";

describe("buildOrderConfirmationPush (D148)", () => {
  it("includes the order id for deep-linking but never the amount or currency", () => {
    const push = buildOrderConfirmationPush({
      orderId: "order-1",
      totalMinor: 12345,
      currency: "USD",
    });

    expect(push.type).toBe("ORDER_CONFIRMATION");
    expect(push.data).toEqual({ type: "ORDER_CONFIRMATION", orderId: "order-1" });
    expect(push.title + push.body).not.toContain("123.45");
    expect(push.title + push.body).not.toContain("USD");
    expect(push.title + push.body).not.toContain("12345");
  });
});

describe("buildReservationReminderPush (D148)", () => {
  it("includes the subject label but never the raw reservation id", () => {
    const push = buildReservationReminderPush({
      reservationId: "reservation-1",
      subjectLabel: "Haircut appointment",
      startsAt: "2026-09-10T14:00:00.000Z",
    });

    expect(push.type).toBe("RESERVATION_REMINDER");
    expect(push.body).toContain("Haircut appointment");
    expect(push.title + push.body).not.toContain("reservation-1");
    expect(push.data).toEqual({ type: "RESERVATION_REMINDER", reservationId: "reservation-1" });
  });
});

describe("buildReturnDuePush (D148)", () => {
  it("includes the subject label but never the raw reservation id", () => {
    const push = buildReturnDuePush({
      reservationId: "reservation-2",
      subjectLabel: "Trailer rental",
      endsAt: "2026-09-12T00:00:00.000Z",
    });

    expect(push.type).toBe("RETURN_DUE");
    expect(push.body).toContain("Trailer rental");
    expect(push.title + push.body).not.toContain("reservation-2");
    expect(push.data).toEqual({ type: "RETURN_DUE", reservationId: "reservation-2" });
  });
});

describe("buildDepositReleasedPush (D148)", () => {
  it("never includes the released amount or currency", () => {
    const push = buildDepositReleasedPush({
      orderId: "order-2",
      amountMinor: 50000,
      currency: "USD",
    });

    expect(push.type).toBe("DEPOSIT_RELEASED");
    expect(push.title + push.body).not.toContain("500.00");
    expect(push.title + push.body).not.toContain("USD");
    expect(push.title + push.body).not.toContain("50000");
    expect(push.data).toEqual({ type: "DEPOSIT_RELEASED", orderId: "order-2" });
  });
});
