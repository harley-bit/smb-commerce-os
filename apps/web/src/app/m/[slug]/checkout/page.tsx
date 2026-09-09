"use client";

import { useParams, useSearchParams } from "next/navigation";
import { PaymentView } from "./PaymentView";

/**
 * `docs/cards/D130.md` — routed at `/m/[slug]/checkout?orderId=...`. No
 * storefront cart HTTP route exists yet (`CartService` remains unwired —
 * D126's log), so `orderId` is carried in the query string rather than
 * looked up from a session-bound cart, same "one more piece of the flow
 * lands per card" posture as every Phase 7 card before this one.
 */
export default function CheckoutPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");

  if (!orderId) {
    return (
      <main>
        <p role="alert">No order to check out.</p>
      </main>
    );
  }

  return <PaymentView slug={params.slug} orderId={orderId} />;
}
