"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { RentalCheckinView } from "../../RentalCheckinView";

function RentalCheckinPageInner() {
  const params = useParams<{ orderLineId: string }>();
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";
  const orderLineId = params.orderLineId;

  if (!merchantId) {
    return (
      <main>
        <h1>Rental check-in</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <RentalCheckinView merchantId={merchantId} orderLineId={orderLineId} />;
}

export default function RentalCheckinPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <RentalCheckinPageInner />
    </Suspense>
  );
}
