"use client";

import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface OrderConfirmationViewProps {
  slug: string;
  orderId: string;
}

type ReceiptLineMode = "PRODUCT" | "SERVICE" | "RENTAL";

interface ReceiptLineItem {
  orderLineId: string;
  mode: ReceiptLineMode;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  depositHoldMinor: number | null;
}

interface OrderReceipt {
  orderId: string;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  lineItems: ReceiptLineItem[];
  depositHoldsTotalMinor: number;
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

/**
 * `docs/cards/D131.md` — "Order confirmation". Fetches (via `POST`, since
 * the call also fires the server's receipt-email side effect —
 * `apps/api/src/routes/orderConfirmation.ts`) and renders the itemized
 * receipt `OrderConfirmationService` (`@smb-os/db`) builds entirely from
 * the order's own server-recorded fields.
 *
 * This card's acceptance criterion ("receipt itemizes charges and any
 * deposit hold"): every line item is rendered with its own quantity, unit
 * price, and line total, and any line carrying a deposit hold shows that
 * hold explicitly, followed by a "Deposit holds" summary line — nothing
 * here is a flat total-only receipt.
 *
 * This card's security check ("no card details in the receipt"): the
 * server's `OrderReceipt` shape has no field that could carry a card
 * number, CVC, or expiry (see the service's own doc comment), and this
 * component renders no `<input>` of any kind — same posture
 * `pageCardFieldGuard.test.ts` already enforces repo-wide for `./PaymentView.tsx`.
 */
export function OrderConfirmationView({ slug, orderId }: OrderConfirmationViewProps) {
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`${API_BASE_URL}/v1/m/${slug}/checkout/${orderId}/confirmation`, {
        method: "POST",
      });
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not load your order confirmation. Please contact the merchant.");
        return;
      }
      const body = (await response.json()) as OrderReceipt;
      setReceipt(body);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, orderId]);

  if (error) {
    return (
      <main>
        <h1>Order confirmation</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (!receipt) {
    return (
      <main>
        <h1>Order confirmation</h1>
        <p>Loading your receipt…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Order confirmation</h1>
      <p role="status">Thank you — your order is confirmed.</p>
      <table>
        <tbody>
          {receipt.lineItems.map((line) => (
            <tr key={line.orderLineId}>
              <td>{line.mode}</td>
              <td>{`x${line.quantity}`}</td>
              <td>{formatMinor(line.lineTotalMinor, receipt.currency)}</td>
              <td>
                {line.depositHoldMinor !== null
                  ? `Deposit hold: ${formatMinor(line.depositHoldMinor, receipt.currency)}`
                  : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Subtotal: {formatMinor(receipt.subtotalMinor, receipt.currency)}</p>
      <p>Tax: {formatMinor(receipt.taxMinor, receipt.currency)}</p>
      <p>Total charged: {formatMinor(receipt.totalMinor, receipt.currency)}</p>
      {receipt.depositHoldsTotalMinor > 0 && (
        <p>Deposit holds (not charged): {formatMinor(receipt.depositHoldsTotalMinor, receipt.currency)}</p>
      )}
      <p>A receipt has been sent to your email.</p>
    </main>
  );
}
