"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ServiceEditor } from "../ServiceEditor";

function NewServicePageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>New service</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <ServiceEditor merchantId={merchantId} />;
}

export default function NewServicePage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <NewServicePageInner />
    </Suspense>
  );
}
