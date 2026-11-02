"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CatalogView } from "./CatalogView";

function CatalogPageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>Catalog</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <CatalogView merchantId={merchantId} />;
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <CatalogPageInner />
    </Suspense>
  );
}
