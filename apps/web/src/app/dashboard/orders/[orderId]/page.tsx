"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { OrderDetailView } from "../OrderDetailView";

function OrderDetailPageInner() {
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";
  const orderId = params.orderId;

  if (!merchantId) {
    return (
      <main>
        <h1>Order</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <OrderDetailView merchantId={merchantId} orderId={orderId} />;
}

export default function OrderDetailPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <OrderDetailPageInner />
    </Suspense>
  );
}
