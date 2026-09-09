"use client";

import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface OrderHistoryViewProps {
  slug: string;
}

type OrderLineMode = "PRODUCT" | "SERVICE" | "RENTAL";

interface OrderHistorySummary {
  id: string;
  status: string;
  currency: string;
  totalMinor: number;
  placedAt: string | null;
  modes: OrderLineMode[];
}

interface OrderHistory {
  upcoming: OrderHistorySummary[];
  past: OrderHistorySummary[];
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

function OrderList({ orders }: { orders: OrderHistorySummary[] }) {
  if (orders.length === 0) {
    return <p>Nothing here yet.</p>;
  }
  return (
    <ul>
      {orders.map((order) => (
        <li key={order.id}>
          {formatMinor(order.totalMinor, order.currency)} — {order.status} — {order.modes.join(", ")}
        </li>
      ))}
    </ul>
  );
}

/**
 * `docs/cards/D132.md` — "Order history". Fetches `GET
 * /v1/m/{slug}/account/orders` with `credentials: "include"` so the
 * session cookie identifies the customer — `apps/api`'s
 * `CustomerOrderHistoryService` filters by that session's own
 * `customerUserId`, never a value this component could supply.
 *
 * This card's deliverable ("past and upcoming across modes"): renders both
 * buckets the server already partitions the order into, each order showing
 * every mode present on it (`modes`), not just one.
 */
export function OrderHistoryView({ slug }: OrderHistoryViewProps) {
  const [history, setHistory] = useState<OrderHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`${API_BASE_URL}/v1/m/${slug}/account/orders`, {
        credentials: "include",
      });
      if (cancelled) return;
      if (response.status === 401) {
        setError("Please sign in to view your order history.");
        return;
      }
      if (!response.ok) {
        setError("Could not load your order history.");
        return;
      }
      setHistory((await response.json()) as OrderHistory);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error) {
    return (
      <main>
        <h1>Your orders</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (!history) {
    return (
      <main>
        <h1>Your orders</h1>
        <p>Loading your orders…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Your orders</h1>
      <section>
        <h2>Upcoming</h2>
        <OrderList orders={history.upcoming} />
      </section>
      <section>
        <h2>Past</h2>
        <OrderList orders={history.past} />
      </section>
    </main>
  );
}
