import { describe, expect, it } from "vitest";
import type { ProviderPayoutRecord } from "./PayoutProvider.js";
import { reconcilePayout } from "./reconcilePayout.js";

function record(overrides: Partial<ProviderPayoutRecord> = {}): ProviderPayoutRecord {
  return {
    payoutId: "po_1",
    currency: "USD",
    arrivalDate: "2026-09-10",
    transactions: [
      { providerRef: "pi_charge_1", grossAmountMinor: 10_000, feeMinor: 320, netAmountMinor: 9_680 },
      { providerRef: "re_refund_1", grossAmountMinor: -2_000, feeMinor: 0, netAmountMinor: -2_000 },
    ],
    ...overrides,
  };
}

describe("reconcilePayout", () => {
  it("reports no mismatch when every provider transaction matches our own recorded amount", () => {
    const ourAmounts = new Map([
      ["pi_charge_1", 10_000],
      ["re_refund_1", -2_000],
    ]);

    const result = reconcilePayout(record(), ourAmounts);

    expect(result.hasMismatch).toBe(false);
    expect(result.lines.every((line) => !line.mismatch)).toBe(true);
    expect(result.grossAmountMinor).toBe(8_000);
    expect(result.feeAmountMinor).toBe(320);
    expect(result.netAmountMinor).toBe(7_680);
  });

  it("flags a mismatch when our recorded amount disagrees with the provider's reported gross", () => {
    const ourAmounts = new Map([
      ["pi_charge_1", 9_000], // our ledger says 9,000, provider says 10,000
      ["re_refund_1", -2_000],
    ]);

    const result = reconcilePayout(record(), ourAmounts);

    expect(result.hasMismatch).toBe(true);
    const chargeLine = result.lines.find((line) => line.providerRef === "pi_charge_1")!;
    expect(chargeLine.mismatch).toBe(true);
    expect(chargeLine.ourAmountMinor).toBe(9_000);
    expect(chargeLine.providerGrossAmountMinor).toBe(10_000);
    const refundLine = result.lines.find((line) => line.providerRef === "re_refund_1")!;
    expect(refundLine.mismatch).toBe(false);
  });

  it("flags a mismatch when the provider reports a transaction we have no matching payment record for", () => {
    const ourAmounts = new Map([["pi_charge_1", 10_000]]); // re_refund_1 missing entirely

    const result = reconcilePayout(record(), ourAmounts);

    expect(result.hasMismatch).toBe(true);
    const refundLine = result.lines.find((line) => line.providerRef === "re_refund_1")!;
    expect(refundLine.mismatch).toBe(true);
    expect(refundLine.ourAmountMinor).toBeNull();
  });

  it("carries the payout's own identity and fee breakdown through untouched", () => {
    const ourAmounts = new Map([
      ["pi_charge_1", 10_000],
      ["re_refund_1", -2_000],
    ]);

    const result = reconcilePayout(record({ payoutId: "po_2", currency: "USD", arrivalDate: "2026-09-15" }), ourAmounts);

    expect(result.payoutId).toBe("po_2");
    expect(result.currency).toBe("USD");
    expect(result.arrivalDate).toBe("2026-09-15");
  });
});
