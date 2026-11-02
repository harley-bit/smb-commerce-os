"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarView } from "./CalendarView";

function CalendarPageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>Calendar</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <CalendarView merchantId={merchantId} />;
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <CalendarPageInner />
    </Suspense>
  );
}
