"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceAvailabilityEditor } from "./ResourceAvailabilityEditor";

function ResourcesPageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>Resources and availability</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <ResourceAvailabilityEditor merchantId={merchantId} />;
}

export default function ResourcesPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <ResourcesPageInner />
    </Suspense>
  );
}
