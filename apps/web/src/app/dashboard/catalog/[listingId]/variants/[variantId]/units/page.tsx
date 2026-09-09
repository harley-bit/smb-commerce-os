"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { InventoryUnitsView } from "../../../../InventoryUnitsView";

function UnitsPageInner() {
  const params = useParams<{ listingId: string; variantId: string }>();
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";
  const { listingId, variantId } = params;

  if (!merchantId) {
    return (
      <main>
        <h1>Inventory units</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <InventoryUnitsView merchantId={merchantId} listingId={listingId} variantId={variantId} />;
}

export default function UnitsPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <UnitsPageInner />
    </Suspense>
  );
}
