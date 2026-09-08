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
      }),
    ).rejects.toThrow();
  });
});
