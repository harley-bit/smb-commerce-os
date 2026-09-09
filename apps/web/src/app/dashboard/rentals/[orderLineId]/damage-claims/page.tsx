"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { DamageClaimView } from "../../DamageClaimView";

function DamageClaimPageInner() {
  const params = useParams<{ orderLineId: string }>();
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";
  const orderLineId = params.orderLineId;

  if (!merchantId) {
    return (
      <main>
        <h1>Damage claim</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <DamageClaimView merchantId={merchantId} orderLineId={orderLineId} />;
}

export default function DamageClaimPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <DamageClaimPageInner />
    </Suspense>
  );
}
