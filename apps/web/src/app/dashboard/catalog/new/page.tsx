"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProductEditor } from "../ProductEditor";

function NewProductPageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>New product</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <ProductEditor merchantId={merchantId} />;
}

export default function NewProductPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <NewProductPageInner />
    </Suspense>
  );
}
