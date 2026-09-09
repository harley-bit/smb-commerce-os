import { describe, expect, it } from "vitest";
import { buildOrderReceipt } from "./orderReceipt.js";

describe("buildOrderReceipt", () => {
  it("itemizes every line and carries the order's own server-recomputed totals", () => {
    const receipt = buildOrderReceipt(
      { id: "order-1", currency: "USD", subtotalMinor: 6000, taxMinor: 500, totalMinor: 6500 },
      [
        {
          id: "line-1",
          mode: "PRODUCT",
          quantity: 2,
          unitPriceMinor: 1000,
          lineTotalMinor: 2000,
          depositMinor: null,
        },
        {
          id: "line-2",
          mode: "RENTAL",
          quantity: 1,
          unitPriceMinor: 4000,
          lineTotalMinor: 4000,
          depositMinor: 20000,
        },
      ],
    );

    expect(receipt).toEqual({
      orderId: "order-1",
      currency: "USD",
      subtotalMinor: 6000,
      taxMinor: 500,
      totalMinor: 6500,
      lineItems: [
        {
          orderLineId: "line-1",
          mode: "PRODUCT",
          quantity: 2,
          unitPriceMinor: 1000,
          lineTotalMinor: 2000,
          depositHoldMinor: null,
        },
        {
          orderLineId: "line-2",
          mode: "RENTAL",
          quantity: 1,
          unitPriceMinor: 4000,
          lineTotalMinor: 4000,
          depositHoldMinor: 20000,
        },
      ],
      depositHoldsTotalMinor: 20000,
    });
  });

  it("sums deposit holds across multiple rental lines", () => {
    const receipt = buildOrderReceipt(
      { id: "order-1", currency: "USD", subtotalMinor: 8000, taxMinor: 0, totalMinor: 8000 },
      [
        {
          id: "line-1",
          mode: "RENTAL",
          quantity: 1,
          unitPriceMinor: 4000,
          lineTotalMinor: 4000,
          depositMinor: 10000,
        },
        {
          id: "line-2",
          mode: "RENTAL",
          quantity: 1,
          unitPriceMinor: 4000,
          lineTotalMinor: 4000,
          depositMinor: 15000,
        },
      ],
    );

    expect(receipt.depositHoldsTotalMinor).toBe(25000);
  });

  it("reports a zero deposit-holds total, not null, when no line carries a deposit", () => {
    const receipt = buildOrderReceipt(
      { id: "order-1", currency: "USD", subtotalMinor: 1000, taxMinor: 0, totalMinor: 1000 },
      [
        {
          id: "line-1",
          mode: "PRODUCT",
          quantity: 1,
          unitPriceMinor: 1000,
          lineTotalMinor: 1000,
          depositMinor: null,
        },
      ],
    );

    expect(receipt.depositHoldsTotalMinor).toBe(0);
    expect(receipt.lineItems[0]?.depositHoldMinor).toBeNull();
  });

  it("treats a zero depositMinor on a line the same as no deposit (null in the receipt)", () => {
    const receipt = buildOrderReceipt(
      { id: "order-1", currency: "USD", subtotalMinor: 1000, taxMinor: 0, totalMinor: 1000 },
      [
        {
          id: "line-1",
          mode: "SERVICE",
          quantity: 1,
          unitPriceMinor: 1000,
          lineTotalMinor: 1000,
          depositMinor: 0,
        },
      ],
    );

    expect(receipt.lineItems[0]?.depositHoldMinor).toBeNull();
    expect(receipt.depositHoldsTotalMinor).toBe(0);
  });

  it("preserves line order and handles an empty cart total with no lines", () => {
    const receipt = buildOrderReceipt(
      { id: "order-1", currency: "USD", subtotalMinor: 0, taxMinor: 0, totalMinor: 0 },
      [],
    );

    expect(receipt.lineItems).toEqual([]);
    expect(receipt.depositHoldsTotalMinor).toBe(0);
  });
});
