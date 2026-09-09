"use client";

import { useEffect, useState } from "react";
import type { PublicProductDetail } from "@smb-os/contracts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface ProductDetailViewProps {
  slug: string;
  listingSlug: string;
}

const STOCK_STATUS_LABEL: Record<PublicProductDetail["variants"][number]["stockStatus"], string> = {
  IN_STOCK: "In stock",
  OUT_OF_STOCK: "Out of stock",
};

/**
 * `docs/cards/D122.md` — the product listing detail page. Reads
 * `apps/api/src/routes/publicStorefront.ts`'s unauthenticated
 * `GET /v1/m/{slug}/listings/{listingSlug}`, whose response is already a
 * narrow `@smb-os/contracts` `PublicProductDetail` — each variant's
 * `stockStatus` is a bucketed `IN_STOCK`/`OUT_OF_STOCK` enum, never the raw
 * count (this card's security check); this view renders exactly that
 * label and never a number of units (this card's acceptance criterion:
 * out-of-stock is reflected accurately, via the label alone).
 */
export function ProductDetailView({ slug, listingSlug }: ProductDetailViewProps) {
  const [detail, setDetail] = useState<PublicProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`${API_BASE_URL}/v1/m/${slug}/listings/${listingSlug}`);
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not find that product.");
        return;
      }
      setDetail((await response.json()) as PublicProductDetail);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, listingSlug]);

  if (error) {
    return (
      <main>
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (!detail) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{detail.name}</h1>
      {detail.description && <p>{detail.description}</p>}
      {detail.variants.length === 0 ? (
        <p>No options available.</p>
      ) : (
        <ul>
          {detail.variants.map((variant) => (
            <li key={variant.id}>
              <span>{variant.name}</span>
              <span> — {STOCK_STATUS_LABEL[variant.stockStatus]}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
