import { describe, expect, it } from "vitest";
import { SimulatedPayoutProvider } from "./SimulatedPayoutProvider.js";

describe("SimulatedPayoutProvider", () => {
  it("returns a payout record after it has been registered", async () => {
    const provider = new SimulatedPayoutProvider();
    provider.registerPayout({
      payoutId: "po_1",
      currency: "USD",
      arrivalDate: "2026-09-10",
      transactions: [{ providerRef: "pi_1", grossAmountMinor: 5_000, feeMinor: 200, netAmountMinor: 4_800 }],
    });

    const record = await provider.getPayout("po_1");

    expect(record.payoutId).toBe("po_1");
    expect(record.transactions).toHaveLength(1);
  });

  it("throws for a payoutId that was never registered", async () => {
    const provider = new SimulatedPayoutProvider();

    await expect(provider.getPayout("po_missing")).rejects.toThrow(/No payout found/);
  });
});
