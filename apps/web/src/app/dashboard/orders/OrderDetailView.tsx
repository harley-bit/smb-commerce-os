"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type OrderLineMode = "PRODUCT" | "SERVICE" | "RENTAL";

interface OrderLineDetail {
  id: string;
  listingId: string;
  listingName: string;
  variantId: string;
  mode: OrderLineMode;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  depositMinor: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

interface OrderDetail {
  id: string;
  status: string;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  placedAt: string | null;
  cancelledAt: string | null;
  modes: OrderLineMode[];
  lines: OrderLineDetail[];
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

export interface OrderDetailViewProps {
  merchantId: string;
  orderId: string;
}

/**
 * `docs/cards/D115.md` — Order detail. Renders `GET /orders/:orderId`
 * (`apps/api/src/routes/orders.ts`). Every line shows its own `mode` and
 * resolved `listingName` — this card's acceptance criterion means a single
 * order mixing a product, a service, and a rental must render all three
 * lines correctly in one table, not just the order's aggregate totals.
 */
export function OrderDetailView({ merchantId, orderId }: OrderDetailViewProps) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOrder() {
      const response = await fetch(`${API_BASE_URL}/orders/${orderId}`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      if (cancelled) return;
      if (!response.ok) {
        setError(response.status === 404 ? "Order not found." : "Could not load this order.");
        return;
      }
      setOrder((await response.json()) as OrderDetail);
    }
    void loadOrder();
    return () => {
      cancelled = true;
    };
  }, [merchantId, orderId]);

  if (error) {
    return (
      <main>
        <h1>Order</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (order === null) {
    return (
      <main>
        <h1>Order</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Order</h1>
      <dl>
        <dt>Status</dt>
        <dd>{order.status}</dd>
        <dt>Placed</dt>
        <dd>{order.placedAt ?? "—"}</dd>
        <dt>Total</dt>
        <dd>{formatMinor(order.totalMinor, order.currency)}</dd>
      </dl>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Mode</th>
            <th>Quantity</th>
            <th>Unit price</th>
            <th>Line total</th>
            <th>Starts</th>
            <th>Ends</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.listingName}</td>
              <td>{line.mode}</td>
              <td>{line.quantity}</td>
              <td>{formatMinor(line.unitPriceMinor, order.currency)}</td>
              <td>{formatMinor(line.lineTotalMinor, order.currency)}</td>
              <td>{line.startsAt ?? "—"}</td>
              <td>{line.endsAt ?? "—"}</td>
              <td>
                {line.mode === "RENTAL" && (
                  <Link href={`/dashboard/rentals/${line.id}/checkout?merchantId=${merchantId}`}>Check out</Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
