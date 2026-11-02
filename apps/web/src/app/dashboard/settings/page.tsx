"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TeamSettingsView } from "./TeamSettingsView";

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const merchantId = searchParams.get("merchantId") ?? "";

  if (!merchantId) {
    return (
      <main>
        <h1>Settings</h1>
        <p role="alert">Missing merchant. Complete business setup first.</p>
      </main>
    );
  }

  return <TeamSettingsView merchantId={merchantId} />;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <SettingsPageInner />
    </Suspense>
  );
}
