"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DepositManagementView } from "./DepositManagementView";

function DepositsPageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>Deposits</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <DepositManagementView merchantId={merchantId} />;
}

export default function DepositsPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <DepositsPageInner />
    </Suspense>
  );
}
