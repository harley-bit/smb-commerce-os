"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../components";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type ConnectStatus =
  | { status: "NOT_STARTED" }
  | { status: "ONBOARDING" | "ACTIVE" | "RESTRICTED"; chargesEnabled: boolean; payoutsEnabled: boolean };

export interface PaymentsViewProps {
  merchantId: string;
}

/**
 * `docs/cards/D104.md` — Connect onboarding UI. This component never
 * collects a bank account/routing number, SSN, or any other underwriting
 * field itself (this card's security check, "no bank details stored by
 * us"): the "Connect payouts" action only ever links out to Stripe's own
 * hosted onboarding form (`apps/api`'s `POST /connect/onboarding`, behind
 * `ConnectAccountProvider`), and this page's own state is limited to the
 * derived `ONBOARDING | ACTIVE | RESTRICTED` status apps/api reports back.
 */
export function PaymentsView({ merchantId }: PaymentsViewProps) {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      const response = await fetch(`${API_BASE_URL}/connect/status`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not load payouts status.");
        return;
      }
      setStatus((await response.json()) as ConnectStatus);
    }
    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  async function handleStart() {
    setError(null);
    setStarting(true);
    const response = await fetch(`${API_BASE_URL}/connect/onboarding`, {
      method: "POST",
      credentials: "include",
      headers: { "x-merchant-id": merchantId },
    });
    setStarting(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
      setError(body.detail ?? body.title ?? "Could not start payouts onboarding.");
      return;
    }

    const body = (await response.json()) as { onboardingUrl: string };
    window.location.href = body.onboardingUrl;
  }

  if (!status) {
    return (
      <main>
        <h1>Payouts</h1>
        {error ? <p role="alert">{error}</p> : <p>Loading…</p>}
      </main>
    );
  }

  if (status.status === "ACTIVE") {
    return (
      <main>
        <h1>Payouts</h1>
        <p>Payouts are enabled. You&rsquo;re ready to accept payments.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Payouts</h1>
      <p>
        {status.status === "NOT_STARTED"
          ? "Connect a payout account to start accepting payments."
          : "Finish your payouts setup on Stripe's hosted form to start accepting payments."}
      </p>
      <Button onClick={handleStart} disabled={starting}>
        {status.status === "NOT_STARTED" ? "Connect payouts" : "Continue payouts setup"}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
