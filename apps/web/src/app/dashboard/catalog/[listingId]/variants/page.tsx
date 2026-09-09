"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { VariantTable } from "../../VariantTable";

function VariantsPageInner() {
  const params = useParams<{ listingId: string }>();
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";
  const listingId = params.listingId;

  if (!merchantId) {
    return (
      <main>
        <h1>Variants</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <VariantTable merchantId={merchantId} listingId={listingId} />;
}

export default function VariantsPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <VariantsPageInner />
    </Suspense>
  );
}
