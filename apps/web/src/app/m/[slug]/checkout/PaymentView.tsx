"use client";

import { useState } from "react";
import { HostedCardField } from "./HostedCardField";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface PaymentViewProps {
  slug: string;
  orderId: string;
}

interface PaymentSuccess {
  amountMinor: number;
  currency: string;
}

interface DeclineDetail {
  detail: string;
  retryableWithSameMethod: boolean;
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

/**
 * `docs/cards/D130.md` — Payment UI. Pays a cart's order via
 * `apps/api/src/routes/checkoutPayment.ts`'s `POST
 * /v1/m/{slug}/checkout/{orderId}/payment-intent`, backed by D089's
 * `CheckoutPaymentService`.
 *
 * This card's acceptance criterion ("no card data in our DOM"): the only
 * place a card could be entered is `HostedCardField` — a mount point,
 * never our own `<input>` — and "Pay" stays disabled until that mount
 * point reports ready, so a submission can never race ahead of it. This
 * page carries no `<input>` for card data at all, `POST
 * .../payment-intent`'s body carries only an idempotency key, and
 * `apps/web/src/security/pageCardFieldGuard.test.ts`'s repo-wide scan
 * (this card's security check, "SAQ A test passes against the live
 * checkout page") runs against this exact file.
 *
 * A `PaymentDeclinedError` (D098) surfaces only the server's already-mapped
 * generic customer message and `retryableWithSameMethod` flag — never a
 * raw decline code — mirroring `CheckoutPaymentService`'s own contract.
 */
export function PaymentView({ slug, orderId }: PaymentViewProps) {
  const [cardFieldReady, setCardFieldReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<PaymentSuccess | null>(null);
  const [decline, setDecline] = useState<DeclineDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePay(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDecline(null);
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/m/${slug}/checkout/${orderId}/payment-intent`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      if (response.status === 402) {
        const body = (await response.json()) as DeclineDetail;
        setDecline(body);
        return;
      }
      if (!response.ok) {
        setError("Could not complete payment. Please try again.");
        return;
      }
      const body = (await response.json()) as PaymentSuccess;
      setSuccess({ amountMinor: body.amountMinor, currency: body.currency });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main>
        <h1>Payment</h1>
        <p role="status">Payment completed — {formatMinor(success.amountMinor, success.currency)} charged.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Payment</h1>
      {error && <p role="alert">{error}</p>}
      {decline && (
        <p role="alert">
          {decline.detail}
          {decline.retryableWithSameMethod ? " You can try again with the same card." : " Please use a different card."}
        </p>
      )}
      <form onSubmit={handlePay}>
        <HostedCardField onReady={() => setCardFieldReady(true)} />
        <button type="submit" disabled={!cardFieldReady || submitting}>
          Pay
        </button>
      </form>
    </main>
  );
}
