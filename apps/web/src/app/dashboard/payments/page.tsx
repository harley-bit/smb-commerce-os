"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PaymentsView } from "./PaymentsView";

function PaymentsPageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>Payouts</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <PaymentsView merchantId={merchantId} />;
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <PaymentsPageInner />
    </Suspense>
  );
}
