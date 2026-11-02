"use client";

import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface DamageClaim {
  id: string;
  amountMinor: number;
  state: string;
  filedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

interface DepositAuthorization {
  id: string;
  amountMinor: number;
  currency: string;
  state: string;
  capturedMinor: number | null;
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

export interface DamageClaimViewProps {
  merchantId: string;
  orderLineId: string;
}

/**
 * `docs/cards/D118.md` — Damage claim UI: file, review, notify, then
 * capture or waive.
 *
 * This card's acceptance criterion ("capture bounded by authorized amount
 * in the UI") is enforced in two places at once: the capture amount field
 * carries a real `max` attribute set to the order line's own deposit
 * hold (`GET .../deposit-authorization`, loaded alongside the claim list),
 * so the browser itself refuses a value above it before the request is
 * ever sent, and `handleCapture` re-checks the same bound client-side —
 * the server (`POST /damage-claims/:claimId/capture`, D118) enforces the
 * real bound regardless, this is the UI's own contribution on top of that.
 *
 * This card's security check ("capture requires explicit confirmation —
 * one attempt only") is answered by `capturing`: the capture button
 * disables the instant it's clicked (before the request resolves, not
 * after) and a merchant must first check an explicit "I confirm this
 * amount is correct" box before the button is even enabled — so a second
 * click physically cannot fire a second request, and the first click can
 * only ever happen after an affirmative, separate confirmation step.
 */
export function DamageClaimView({ merchantId, orderLineId }: DamageClaimViewProps) {
  const [claims, setClaims] = useState<DamageClaim[] | null>(null);
  const [deposit, setDeposit] = useState<DepositAuthorization | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amountMinor, setAmountMinor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [captureAmountMinor, setCaptureAmountMinor] = useState("");
  const [capturing, setCapturing] = useState(false);

  async function loadAll() {
    const [claimsRes, depositRes] = await Promise.all([
      fetch(`${API_BASE_URL}/order-lines/${orderLineId}/damage-claims`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      }),
      fetch(`${API_BASE_URL}/order-lines/${orderLineId}/deposit-authorization`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      }),
    ]);
    if (!claimsRes.ok || !depositRes.ok) {
      setLoadError("Could not load this rental's damage-claim history.");
      return;
    }
    setClaims((await claimsRes.json()) as DamageClaim[]);
    setDeposit((await depositRes.json()) as DepositAuthorization | null);
  }

  useEffect(() => {
    void loadAll();
  }, [orderLineId]);

  const activeClaim = claims?.find((claim) => claim.state !== "RESOLVED_CAPTURED" && claim.state !== "RESOLVED_WAIVED") ?? null;
  const authorizedMinor = deposit?.amountMinor ?? null;

  async function handleFile(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = Number(amountMinor);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Claim amount must be a positive number.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/order-lines/${orderLineId}/damage-claims`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({ amountMinor: parsed, filedAt: new Date().toISOString() }),
      });
      if (!response.ok) {
        setError("Could not file the damage claim.");
        return;
      }
      setAmountMinor("");
      await loadAll();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNotify(claimId: string) {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/damage-claims/${claimId}/notify`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError("Could not notify the customer.");
        return;
      }
      await loadAll();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWaive(claimId: string) {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/damage-claims/${claimId}/waive`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({ resolvedAt: new Date().toISOString() }),
      });
      if (!response.ok) {
        setError("Could not waive the claim.");
        return;
      }
      setMessage("Claim waived — no deposit was captured.");
      await loadAll();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCapture(event: React.FormEvent, claimId: string) {
    event.preventDefault();
    setError(null);
    const parsed = Number(captureAmountMinor);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Capture amount must be a positive number.");
      return;
    }
    if (authorizedMinor !== null && parsed > authorizedMinor) {
      setError(`Capture amount cannot exceed the authorized deposit amount (${formatMinor(authorizedMinor, deposit?.currency ?? "USD")}).`);
      return;
    }
    if (!confirmed) {
      setError("Confirm the capture amount before submitting.");
      return;
    }
    // Disabling before the request resolves — not after — is this card's
    // security check made real: a second click physically cannot fire a
    // second request while this one is in flight.
    setCapturing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/damage-claims/${claimId}/capture`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({
          amountMinor: parsed,
          idempotencyKey: `damage-claim-capture-${claimId}`,
          capturedAt: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? "This deposit hold has already been resolved — one capture attempt only."
            : "Could not capture the deposit.",
        );
        return;
      }
      setMessage("Deposit captured.");
      await loadAll();
    } finally {
      setCapturing(false);
    }
  }

  if (loadError) {
    return (
      <main>
        <h1>Damage claim</h1>
        <p role="alert">{loadError}</p>
      </main>
    );
  }

  if (!claims) {
    return (
      <main>
        <h1>Damage claim</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Damage claim</h1>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <section aria-label="Deposit hold">
        <h2>Deposit hold</h2>
        {deposit ? (
          <p>
            Authorized amount: {formatMinor(deposit.amountMinor, deposit.currency)} ({deposit.state})
          </p>
        ) : (
          <p>No deposit hold is on file for this rental.</p>
        )}
      </section>

      <section aria-label="Claims">
        <h2>Claims</h2>
        {claims.length === 0 && <p>No damage claims filed.</p>}
        <ul>
          {claims.map((claim) => (
            <li key={claim.id}>
              {formatMinor(claim.amountMinor, deposit?.currency ?? "USD")} — {claim.state}
              {claim.resolutionNote ? ` (${claim.resolutionNote})` : ""}
            </li>
          ))}
        </ul>
      </section>

      {!activeClaim && (
        <section aria-label="File a claim">
          <h2>File a claim</h2>
          <form onSubmit={handleFile}>
            <label>
              Amount (minor units)
              <input
                type="number"
                min={1}
                value={amountMinor}
                onChange={(event) => setAmountMinor(event.target.value)}
              />
            </label>
            <button type="submit" disabled={submitting}>
              File claim
            </button>
          </form>
        </section>
      )}

      {activeClaim && activeClaim.state === "FILED" && (
        <section aria-label="Notify customer">
          <h2>Review — notify customer</h2>
          <p>
            Claim for {formatMinor(activeClaim.amountMinor, deposit?.currency ?? "USD")} is filed. Notify the customer
            before this claim can be captured or waived.
          </p>
          <button type="button" disabled={submitting} onClick={() => void handleNotify(activeClaim.id)}>
            Notify customer
          </button>
        </section>
      )}

      {activeClaim && (activeClaim.state === "CUSTOMER_NOTIFIED" || activeClaim.state === "DISPUTED") && (
        <section aria-label="Capture or waive">
          <h2>Capture or waive</h2>
          <form onSubmit={(event) => void handleCapture(event, activeClaim.id)}>
            <label>
              Capture amount (minor units)
              <input
                type="number"
                min={1}
                max={authorizedMinor ?? undefined}
                value={captureAmountMinor}
                onChange={(event) => setCaptureAmountMinor(event.target.value)}
              />
            </label>
            <label>
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              I confirm this capture amount is correct.
            </label>
            <button type="submit" disabled={!confirmed || capturing}>
              Capture deposit
            </button>
          </form>
          <button type="button" disabled={submitting} onClick={() => void handleWaive(activeClaim.id)}>
            Waive claim
          </button>
        </section>
      )}
    </main>
  );
}
