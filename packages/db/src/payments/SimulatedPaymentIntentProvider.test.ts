import { describe, expect, it } from "vitest";
import { SimulatedPaymentIntentProvider } from "./SimulatedPaymentIntentProvider.js";

describe("SimulatedPaymentIntentProvider", () => {
  it("creates a PaymentIntent carrying the requested amount and application fee", async () => {
    const provider = new SimulatedPaymentIntentProvider();

    const result = await provider.createPaymentIntent({
      orderId: "order-1",
      amountMinor: 10_000,
      currency: "USD",
      connectedAccountId: "acct_123",
      applicationFeeAmountMinor: 250,
      idempotencyKey: "idem-1",
    });

    expect(result.intentId).toMatch(/^pi_/);
    expect(result.clientSecret).toContain(result.intentId);
    expect(result.status).toBe("REQUIRES_PAYMENT_METHOD");
    expect(result.amountMinor).toBe(10_000);
    expect(result.applicationFeeAmountMinor).toBe(250);
    expect(result.connectedAccountId).toBe("acct_123");

    expect(provider.getRecordedIntent(result.intentId)).toEqual(result);
  });

  it("rejects an application fee larger than the charge amount", async () => {
    const provider = new SimulatedPaymentIntentProvider();

    await expect(
      provider.createPaymentIntent({
        orderId: "order-1",
        amountMinor: 100,
        currency: "USD",
        connectedAccountId: "acct_123",
        applicationFeeAmountMinor: 101,
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow();
  });

  it("D090 acceptance criteria: replaying the same Idempotency-Key returns the original PaymentIntent, not a duplicate", async () => {
    const provider = new SimulatedPaymentIntentProvider();
    const input = {
      orderId: "order-1",
      amountMinor: 10_000,
      currency: "USD",
      connectedAccountId: "acct_123",
      applicationFeeAmountMinor: 250,
      idempotencyKey: "idem-1",
    };

    const first = await provider.createPaymentIntent(input);
    const replay = await provider.createPaymentIntent(input);

    expect(replay).toEqual(first);
    expect(provider.intentCount()).toBe(1);
  });

  it("mints a distinct PaymentIntent for a different Idempotency-Key", async () => {
    const provider = new SimulatedPaymentIntentProvider();
    const input = {
      orderId: "order-1",
      amountMinor: 10_000,
      currency: "USD",
      connectedAccountId: "acct_123",
      applicationFeeAmountMinor: 250,
    };

    const first = await provider.createPaymentIntent({ ...input, idempotencyKey: "idem-1" });
    const second = await provider.createPaymentIntent({ ...input, idempotencyKey: "idem-2" });

    expect(second.intentId).not.toBe(first.intentId);
    expect(provider.intentCount()).toBe(2);
  });

  it("D098: declines every subsequent attempt against an order once seeded, carrying the raw decline code", async () => {
    const provider = new SimulatedPaymentIntentProvider();
    provider.simulateDeclineForOrder("order-1", "insufficient_funds");

    const input = {
      orderId: "order-1",
      amountMinor: 10_000,
      currency: "USD",
      connectedAccountId: "acct_123",
      applicationFeeAmountMinor: 250,
    };

    const first = await provider.createPaymentIntent({ ...input, idempotencyKey: "idem-1" });
    expect(first.status).toBe("DECLINED");
    expect(first.declineCode).toBe("insufficient_funds");

    const retrySameCard = await provider.createPaymentIntent({ ...input, idempotencyKey: "idem-2" });
    expect(retrySameCard.status).toBe("DECLINED");
  });

  it("D098: a decline stops once cleared, modeling the customer switching payment methods", async () => {
    const provider = new SimulatedPaymentIntentProvider();
    provider.simulateDeclineForOrder("order-1", "expired_card");

    const input = {
      orderId: "order-1",
      amountMinor: 10_000,
      currency: "USD",
      connectedAccountId: "acct_123",
      applicationFeeAmountMinor: 250,
    };

    const declined = await provider.createPaymentIntent({ ...input, idempotencyKey: "idem-1" });
    expect(declined.status).toBe("DECLINED");

    provider.clearDeclineForOrder("order-1");
    const succeeded = await provider.createPaymentIntent({ ...input, idempotencyKey: "idem-2" });
    expect(succeeded.status).toBe("REQUIRES_PAYMENT_METHOD");
    expect(succeeded.declineCode).toBeUndefined();
  });

  it("rejects a missing Idempotency-Key", async () => {
    const provider = new SimulatedPaymentIntentProvider();

    await expect(
      provider.createPaymentIntent({
        orderId: "order-1",
        amountMinor: 10_000,
        currency: "USD",
        connectedAccountId: "acct_123",
        applicationFeeAmountMinor: 250,
        idempotencyKey: "",
      }),
    ).rejects.toThrow(/idempotency/i);
  });
});
