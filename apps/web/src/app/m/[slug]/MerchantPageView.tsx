"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ListingMode, PublicListing, PublicMerchantProfile } from "@smb-os/contracts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface MerchantPageViewProps {
  slug: string;
}

const MODE_SECTIONS: ReadonlyArray<{ mode: ListingMode; heading: string }> = [
  { mode: "PRODUCT", heading: "Products" },
  { mode: "SERVICE", heading: "Services" },
  { mode: "RENTAL", heading: "Rentals" },
];

/**
 * `docs/cards/D121.md` — the public merchant page. Reads `apps/api/src/routes/publicStorefront.ts`'s
 * unauthenticated `GET /v1/m/{slug}` and `GET /v1/m/{slug}/listings`
 * (`docs/design/06`'s "mixed catalog, filter by mode"). All three modes
 * are rendered as their own always-present section on this one page
 * (this card's acceptance criterion) rather than behind tabs, so a
 * mixed-mode merchant's full catalog is visible without an extra click.
 * Both responses already carry only public fields (`@smb-os/contracts`'s
 * `Public*` schemas) — this view forwards them as-is and adds no
 * merchant-internal data of its own (this card's security check).
 */
export function MerchantPageView({ slug }: MerchantPageViewProps) {
  const [profile, setProfile] = useState<PublicMerchantProfile | null>(null);
  const [listings, setListings] = useState<PublicListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [profileResponse, listingsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/v1/m/${slug}`),
        fetch(`${API_BASE_URL}/v1/m/${slug}/listings`),
      ]);
      if (cancelled) return;
      if (!profileResponse.ok) {
        setError("Could not find that merchant.");
        return;
      }
      setProfile((await profileResponse.json()) as PublicMerchantProfile);
      setListings(listingsResponse.ok ? ((await listingsResponse.json()) as PublicListing[]) : []);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error) {
    return (
      <main>
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (!profile || !listings) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{profile.name}</h1>
      {MODE_SECTIONS.map(({ mode, heading }) => {
        const inMode = listings.filter((listing) => listing.mode === mode);
        return (
          <section key={mode}>
            <h2>{heading}</h2>
            {inMode.length === 0 ? (
              <p>Nothing here yet.</p>
            ) : (
              <ul>
                {inMode.map((listing) => (
                  <li key={listing.id}>
                    {listing.mode === "PRODUCT" || listing.mode === "SERVICE" ? (
                      <Link href={`/m/${slug}/l/${listing.slug}`}>{listing.name}</Link>
                    ) : (
                      listing.name
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </main>
  );
}
