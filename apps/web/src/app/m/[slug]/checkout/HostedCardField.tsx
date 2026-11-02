"use client";

import { useEffect, useState } from "react";

export interface HostedCardFieldProps {
  onReady: () => void;
}

/**
 * `docs/cards/D130.md` — stands in for Stripe Elements' `<CardElement>`
 * mount point (a real integration mounts Stripe's own iframe into this
 * `<div>`; no build in this repo has a live Stripe.js dependency yet, same
 * "native/simulated now, real provider later" posture as every other
 * payments seam here). This is the only place a card number, expiry, or CVC
 * could ever be entered on this page, and it is never our own `<input>` —
 * `apps/web/src/security/cardFieldScanner.ts`'s repo-wide scan
 * (`pageCardFieldGuard.test.ts`) is this card's "SAQ A test" security check,
 * and it runs against this exact file on every `pnpm test`.
 */
export function HostedCardField({ onReady }: HostedCardFieldProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    onReady();
  }, [onReady]);

  return (
    <div aria-label="Card details" data-testid="hosted-card-field">
      {mounted ? "Card details (hosted by payment provider)" : "Loading payment form…"}
    </div>
  );
}
