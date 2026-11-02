"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type DepositBucket = "HELD" | "EXPIRING_SOON" | "CAPTURED" | "RELEASED" | "EXPIRED";

interface DepositRow {
  id: string;
  orderLineId: string;
  amountMinor: number;
  currency: string;
  state: string;
  authorizedAt: string;
  expiresAt: string;
  capturedMinor: number | null;
  releasedAt: string | null;
  bucket: DepositBucket;
}

export interface DepositManagementViewProps {
  merchantId: string;
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

const SECTIONS: { bucket: DepositBucket; title: string }[] = [
  { bucket: "EXPIRING_SOON", title: "Expiring soon" },
  { bucket: "HELD", title: "Held" },
  { bucket: "CAPTURED", title: "Captured" },
  { bucket: "RELEASED", title: "Released" },
  { bucket: "EXPIRED", title: "Expired" },
];

/**
 * `docs/cards/D119.md` — Deposit management view: held, released,
 * captured, expiring soon, all read from a single `GET /deposits`
 * (`apps/api/src/routes/damageClaims.ts`), merchant-scoped through
 * `DepositAuthorizationRepository`'s `TenantScopedRepository` base, same
 * `X-Merchant-Id`-header pattern every other dashboard view in this app
 * uses.
 *
 * This card's acceptance criterion ("expiring holds surfaced before they
 * lapse") is why "Expiring soon" renders as its own section, first, rather
 * than folded into "Held" — a merchant scanning this page sees the
 * time-sensitive holds before anything else, without having to notice a
 * subtler visual cue on an otherwise-uniform list. The bucket itself is
 * computed server-side (`classifyDepositForDashboard`, `@smb-os/domain`)
 * so this component never re-derives the expiring-soon window.
 *
 * This card's security check ("prevents silent expiry on customer cards")
 * is answered structurally, not by this view alone: `DepositAutoReleaseJob`
 * (D080) already releases a hold deliberately, with notification, before
 * expiry whenever a rental completes with no claim on file — this view is
 * the merchant-facing complement, surfacing any hold that job hasn't
 * caught yet (still `AUTHORIZED` and inside the expiring-soon window) so a
 * merchant can act on it — release or resolve a claim — rather than
 * discovering a lapsed hold only after the fact. Each row links to the
 * damage-claim view (`DamageClaimView.tsx`, D118) for that order line,
 * the one place a claim can be filed or a hold released.
 */
export function DepositManagementView({ merchantId }: DepositManagementViewProps) {
  const [deposits, setDeposits] = useState<DepositRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadDeposits() {
      const response = await fetch(`${API_BASE_URL}/deposits`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not load deposit holds.");
        return;
      }
      setDeposits((await response.json()) as DepositRow[]);
    }
    void loadDeposits();
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  if (error) {
    return (
      <main>
        <h1>Deposits</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (!deposits) {
    return (
      <main>
        <h1>Deposits</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (deposits.length === 0) {
    return (
      <main>
        <h1>Deposits</h1>
        <p>No deposit holds yet.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Deposits</h1>
      {SECTIONS.map(({ bucket, title }) => {
        const rows = deposits.filter((deposit) => deposit.bucket === bucket);
        if (rows.length === 0) return null;
        return (
          <section aria-label={title} key={bucket}>
            <h2>{title}</h2>
            <table>
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((deposit) => (
                  <tr key={deposit.id}>
                    <td>{formatMinor(deposit.amountMinor, deposit.currency)}</td>
                    <td>{deposit.expiresAt}</td>
                    <td>
                      <Link href={`/dashboard/rentals/${deposit.orderLineId}/damage-claims?merchantId=${merchantId}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}
