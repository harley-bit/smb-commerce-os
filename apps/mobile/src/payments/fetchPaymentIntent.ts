export interface CreatePaymentIntentDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
  generateIdempotencyKey: () => string;
}

export type CreatePaymentIntentResult =
  | { ok: true; amountMinor: number; currency: string }
  | { ok: false; kind: "declined"; detail: string; retryableWithSameMethod: boolean }
  | { ok: false; kind: "error"; message: string };

interface PaymentIntentSuccessBody {
  amountMinor: number;
  currency: string;
}

interface PaymentIntentDeclineBody {
  detail: string;
  retryableWithSameMethod: boolean;
}

/**
 * `docs/cards/D146.md` — mobile checkout's payment step, calling the same
 * unauthenticated `POST /v1/m/{slug}/checkout/{orderId}/payment-intent`
 * (`apps/api/src/routes/checkoutPayment.ts`, D130) the web `PaymentView`
 * already uses. This card's security check ("no card data touches our code
 * on mobile either"): the request carries no body at all — only a fresh
 * `Idempotency-Key` header — and the only place a card could be entered is
 * `./HostedCardField.tsx`, never anything in this module.
 *
 * On decline (402), only the server's already-mapped generic customer
 * message and `retryableWithSameMethod` flag are read out of the response —
 * any raw provider decline code the body might also carry is ignored, same
 * contract as web's `PaymentView.tsx`.
 */
export async function createPaymentIntent(
  deps: CreatePaymentIntentDeps,
  slug: string,
  orderId: string,
): Promise<CreatePaymentIntentResult> {
  const response = await deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}/checkout/${orderId}/payment-intent`, {
    method: "POST",
    headers: { "idempotency-key": deps.generateIdempotencyKey() },
  });

  if (response.status === 402) {
    const body = (await response.json()) as PaymentIntentDeclineBody;
    return { ok: false, kind: "declined", detail: body.detail, retryableWithSameMethod: body.retryableWithSameMethod };
  }

  if (!response.ok) {
    return { ok: false, kind: "error", message: "Could not complete payment. Please try again." };
  }

  const body = (await response.json()) as PaymentIntentSuccessBody;
  return { ok: true, amountMinor: body.amountMinor, currency: body.currency };
}
