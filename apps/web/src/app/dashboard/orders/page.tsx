"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OrderListView } from "./OrderListView";

function OrdersPageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>Orders</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <OrderListView merchantId={merchantId} />;
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <OrdersPageInner />
    </Suspense>
  );
}
