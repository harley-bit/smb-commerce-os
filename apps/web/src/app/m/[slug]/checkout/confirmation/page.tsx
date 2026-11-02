"use client";

import { useParams, useSearchParams } from "next/navigation";
import { OrderConfirmationView } from "./OrderConfirmationView";

/**
 * `docs/cards/D131.md` — routed at `/m/[slug]/checkout/confirmation?orderId=...`,
 * same query-string-carried-`orderId` posture as `../page.tsx` (D130) —
 * `CartService` still has no HTTP route (D126's open gap), so there is no
 * session-bound cart to look the order up from.
 */
export default function OrderConfirmationPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");

  if (!orderId) {
    return (
      <main>
        <p role="alert">No order to confirm.</p>
      </main>
    );
  }

  return <OrderConfirmationView slug={params.slug} orderId={orderId} />;
}
