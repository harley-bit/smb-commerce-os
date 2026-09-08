import { describe, expect, it } from "vitest";
import { SimulatedRefundProvider } from "./SimulatedRefundProvider.js";

describe("SimulatedRefundProvider", () => {
  it("creates a refund against the original charge for the requested amount", async () => {
    const provider = new SimulatedRefundProvider();

    const result = await provider.createRefund({
      chargeProviderRef: "pi_charge_1",
      amountMinor: 2_500,
      currency: "USD",
      idempotencyKey: "refund-idem-1",
    });

    expect(result.refundId).toMatch(/^re_/);
    expect(result.chargeProviderRef).toBe("pi_charge_1");
    expect(result.amountMinor).toBe(2_500);
    expect(result.status).toBe("SUCCEEDED");
  });

  it("replaying the same Idempotency-Key returns the original refund, not a duplicate", async () => {
    const provider = new SimulatedRefundProvider();
    const input = {
      chargeProviderRef: "pi_charge_1",
      amountMinor: 2_500,
      currency: "USD",
      idempotencyKey: "refund-idem-1",
    };

    const first = await provider.createRefund(input);
    const replay = await provider.createRefund(input);

    expect(replay).toEqual(first);
    expect(provider.refundCount()).toBe(1);
  });

  it("mints a distinct refund for a different Idempotency-Key", async () => {
    const provider = new SimulatedRefundProvider();
    const input = { chargeProviderRef: "pi_charge_1", amountMinor: 1_000, currency: "USD" };

    const first = await provider.createRefund({ ...input, idempotencyKey: "refund-idem-1" });
    const second = await provider.createRefund({ ...input, idempotencyKey: "refund-idem-2" });

    expect(second.refundId).not.toBe(first.refundId);
    expect(provider.refundCount()).toBe(2);
  });

  it("rejects a missing Idempotency-Key", async () => {
    const provider = new SimulatedRefundProvider();

    await expect(
      provider.createRefund({
        chargeProviderRef: "pi_charge_1",
        amountMinor: 1_000,
        currency: "USD",
        idempotencyKey: "",
      }),
    ).rejects.toThrow(/idempotency/i);
  });

  it("rejects a non-positive refund amount", async () => {
    const provider = new SimulatedRefundProvider();

    await expect(
      provider.createRefund({
        chargeProviderRef: "pi_charge_1",
        amountMinor: 0,
        currency: "USD",
        idempotencyKey: "refund-idem-zero",
      }),
    ).rejects.toThrow();
  });
});
