"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { RentalCheckoutView } from "../../RentalCheckoutView";

function RentalCheckoutPageInner() {
  const params = useParams<{ orderLineId: string }>();
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";
  const orderLineId = params.orderLineId;

  if (!merchantId) {
    return (
      <main>
        <h1>Rental check-out</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <RentalCheckoutView merchantId={merchantId} orderLineId={orderLineId} />;
}

export default function RentalCheckoutPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <RentalCheckoutPageInner />
    </Suspense>
  );
}
