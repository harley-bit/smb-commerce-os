import { describe, expect, it } from "vitest";
import {
  buildDepositReleasedNotification,
  buildOrderConfirmationNotification,
  buildReservationReminderNotification,
  buildReturnDueNotification,
} from "./transactionalNotifications.js";

describe("buildOrderConfirmationNotification (D134)", () => {
  it("includes the order id and formatted total", () => {
    const notification = buildOrderConfirmationNotification({
      orderId: "order-1",
      totalMinor: 12345,
      currency: "USD",
    });

    expect(notification.type).toBe("ORDER_CONFIRMATION");
    expect(notification.body).toContain("order-1");
    expect(notification.body).toContain("123.45 USD");
  });
});

describe("buildReservationReminderNotification (D134)", () => {
  it("includes the subject label and start time", () => {
    const notification = buildReservationReminderNotification({
      subjectLabel: "Haircut appointment",
      startsAt: "2026-09-10T14:00:00.000Z",
    });

    expect(notification.type).toBe("RESERVATION_REMINDER");
    expect(notification.body).toContain("Haircut appointment");
    expect(notification.body).toContain("2026-09-10T14:00:00.000Z");
  });
});

describe("buildReturnDueNotification (D134)", () => {
  it("includes the subject label and due date", () => {
    const notification = buildReturnDueNotification({
      subjectLabel: "Trailer rental",
      endsAt: "2026-09-12T00:00:00.000Z",
    });

    expect(notification.type).toBe("RETURN_DUE");
    expect(notification.body).toContain("Trailer rental");
    expect(notification.body).toContain("2026-09-12T00:00:00.000Z");
  });
});

describe("buildDepositReleasedNotification (D134)", () => {
  it("includes the formatted released amount", () => {
    const notification = buildDepositReleasedNotification({ amountMinor: 20000, currency: "USD" });

    expect(notification.type).toBe("DEPOSIT_RELEASED");
    expect(notification.body).toContain("200.00 USD");
  });
});
