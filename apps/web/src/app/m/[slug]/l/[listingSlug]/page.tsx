"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ListingMode } from "@smb-os/contracts";
import { ProductDetailView } from "./ProductDetailView";
import { RentalDetailView } from "./RentalDetailView";
import { ServiceDetailView } from "./ServiceDetailView";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * `docs/cards/D123.md` extended `docs/cards/D122.md`'s single-mode detail
 * route to two listing modes, `docs/cards/D124.md` extends it to all three
 * (PRODUCT, SERVICE, RENTAL) sharing one URL
 * (`/m/[slug]/l/[listingSlug]`) — this page reads just the `mode` field
 * from `GET /v1/m/{slug}/listings/{listingSlug}` to pick which view renders
 * it, so `ProductDetailView`/`ServiceDetailView`/`RentalDetailView` stay
 * mode-specific, self-contained components (each re-fetches the same
 * detail for its own fields) rather than one view branching internally on
 * every mode.
 */
export default function ListingDetailPage() {
  const params = useParams<{ slug: string; listingSlug: string }>();
  const [mode, setMode] = useState<ListingMode | "NOT_FOUND" | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`${API_BASE_URL}/v1/m/${params.slug}/listings/${params.listingSlug}`);
      if (cancelled) return;
      if (!response.ok) {
        setMode("NOT_FOUND");
        return;
      }
      const body = (await response.json()) as { mode: ListingMode };
      setMode(body.mode);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.slug, params.listingSlug]);

  if (mode === "SERVICE") {
    return <ServiceDetailView slug={params.slug} listingSlug={params.listingSlug} />;
  }
  if (mode === "RENTAL") {
    return <RentalDetailView slug={params.slug} listingSlug={params.listingSlug} />;
  }
  if (mode === "PRODUCT") {
    return <ProductDetailView slug={params.slug} listingSlug={params.listingSlug} />;
  }
  if (mode === "NOT_FOUND") {
    return (
      <main>
        <p role="alert">Could not find that listing.</p>
      </main>
    );
  }
  return (
    <main>
      <p>Loading…</p>
    </main>
  );
}
