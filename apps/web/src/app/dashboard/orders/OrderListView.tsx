"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type OrderLineMode = "PRODUCT" | "SERVICE" | "RENTAL";

interface OrderSummary {
  id: string;
  status: string;
  currency: string;
  totalMinor: number;
  placedAt: string | null;
  modes: OrderLineMode[];
}

export interface OrderListViewProps {
  merchantId: string;
}

/**
 * `docs/cards/D115.md` — Order list. Renders `GET /orders`
 * (`apps/api/src/routes/orders.ts`) — merchant-scoped through
 * `OrderService`/`OrderRepository`'s `TenantScopedRepository` base, the
 * same `X-Merchant-Id`-header pattern `CalendarView`/`CatalogView`
 * established. This card's acceptance criterion — "orders from all three
 * modes render correctly" — is why every row lists its full `modes` set
 * (an order can carry `PRODUCT`, `SERVICE`, and `RENTAL` lines together)
 * rather than a single mode.
 */
export function OrderListView({ merchantId }: OrderListViewProps) {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOrders() {
      const response = await fetch(`${API_BASE_URL}/orders`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not load orders.");
        return;
      }
      setOrders((await response.json()) as OrderSummary[]);
    }
    void loadOrders();
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  if (error) {
    return (
      <main>
        <h1>Orders</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Orders</h1>
      {orders === null ? (
        <p>Loading…</p>
      ) : orders.length === 0 ? (
        <p>No orders yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Placed</th>
              <th>Status</th>
              <th>Modes</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>{order.placedAt ?? "—"}</td>
                <td>{order.status}</td>
                <td>{order.modes.join(", ")}</td>
                <td>
                  {(order.totalMinor / 100).toFixed(2)} {order.currency}
                </td>
                <td>
                  <Link href={`/dashboard/orders/${order.id}?merchantId=${merchantId}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
