"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RentalEditor } from "../RentalEditor";

function NewRentalPageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>New rental</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <RentalEditor merchantId={merchantId} />;
}

export default function NewRentalPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <NewRentalPageInner />
    </Suspense>
  );
}
