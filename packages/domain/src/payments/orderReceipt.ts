/**
 * `docs/cards/D131.md` — "Order confirmation". Pure domain math, no I/O —
 * same shape as `depositDisclosure.ts`. The receipt is assembled entirely
 * from the order's own server-recomputed totals (`CartService`'s
 * `recomputeTotals`, D043/D126) and each line's own server-recorded
 * `unitPriceMinor`/`lineTotalMinor`/`depositMinor` — never from client
 * input, so a receipt can never itemize a charge or deposit hold that
 * differs from what will actually be billed.
 *
 * This card's security check ("no card details in the receipt"): neither
 * input shape below has any field that could carry a card number, CVC, or
 * expiry — an order and its lines are catalog/money data only — so there is
 * no field on `OrderReceipt` a caller could accidentally populate with card
 * data even by mistake.
 */

export type ReceiptOrderLineMode = "PRODUCT" | "SERVICE" | "RENTAL";

export interface ReceiptOrderInput {
  readonly id: string;
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
}

export interface ReceiptOrderLineInput {
  readonly id: string;
  readonly mode: ReceiptOrderLineMode;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly depositMinor: number | null;
}

export interface ReceiptLineItem {
  readonly orderLineId: string;
  readonly mode: ReceiptOrderLineMode;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly depositHoldMinor: number | null;
}

export interface OrderReceipt {
  readonly orderId: string;
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly lineItems: readonly ReceiptLineItem[];
  /** Sum of every line's deposit hold — 0, never null, when no line carries one. */
  readonly depositHoldsTotalMinor: number;
}

export function buildOrderReceipt(order: ReceiptOrderInput, lines: readonly ReceiptOrderLineInput[]): OrderReceipt {
  let depositHoldsTotalMinor = 0;

  const lineItems = lines.map((line) => {
    const depositHoldMinor = line.depositMinor && line.depositMinor > 0 ? line.depositMinor : null;
    if (depositHoldMinor !== null) {
      depositHoldsTotalMinor += depositHoldMinor;
    }
    return {
      orderLineId: line.id,
      mode: line.mode,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
      depositHoldMinor,
    };
  });

  return {
    orderId: order.id,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
    lineItems,
    depositHoldsTotalMinor,
  };
}
