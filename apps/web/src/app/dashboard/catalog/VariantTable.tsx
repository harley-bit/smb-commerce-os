"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import type { Variant } from "@smb-os/contracts";
import Link from "next/link";
import { Button, TextField } from "../../../components";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Mirrors `@smb-os/contracts`'s `updateVariantInputSchema` price rule
 * (an integer minor-units amount, non-empty currency) without importing
 * the real schema — same `node:crypto`-via-`@smb-os/domain` bundling
 * reason `ProductEditor.tsx` documents. `VariantService.update`
 * (`packages/db`) is the real authority server-side; this is a fast,
 * honest echo of it so a merchant sees a rejected row before any fetch
 * fires (this card's security check is separate — see below).
 */
const rowEditSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  priceMinor: z.number().int(),
  currency: z.string().min(1),
});

interface RowDraft {
  sku: string;
  name: string;
  priceMinor: string;
  currency: string;
}

function draftFromVariant(variant: Variant): RowDraft {
  return {
    sku: variant.sku,
    name: variant.name,
    priceMinor: String(variant.priceMinor),
    currency: variant.currency,
  };
}

export interface VariantTableProps {
  merchantId: string;
  listingId: string;
}

/**
 * `docs/cards/D109.md` — Variant management. Fetches every variant on the
 * listing, renders one editable row per variant, and saves all edited rows
 * in a single "Save changes" action via the new
 * `PUT /listings/:listingId/variants/:variantId` route
 * (`apps/api/src/routes/variants.ts`) — this card's acceptance criterion
 * ("bulk edit works; prices validated"). Every row is checked against
 * `rowEditSchema` before any PUT fires; a single invalid row blocks the
 * whole batch rather than partially saving. This card's security check —
 * "price changes do not affect historical orders" — is proven server-side
 * in `apps/api/test/variants.test.ts` (`order_lines.unit_price_minor`/
 * `line_total_minor` are copied at checkout time and never re-read from
 * `listing_variants`, per `docs/design/03`); nothing in this component
 * touches an order or its lines.
 */
export function VariantTable({ merchantId, listingId }: VariantTableProps) {
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadVariants() {
    const response = await fetch(`${API_BASE_URL}/listings/${listingId}/variants`, {
      credentials: "include",
      headers: { "x-merchant-id": merchantId },
    });
    if (!response.ok) {
      setError("Could not load variants.");
      return;
    }
    const loaded = (await response.json()) as Variant[];
    setVariants(loaded);
    setDrafts(Object.fromEntries(loaded.map((variant) => [variant.id, draftFromVariant(variant)])));
  }

  useEffect(() => {
    void loadVariants();
  }, [merchantId, listingId]);

  function updateDraft(variantId: string, patch: Partial<RowDraft>) {
    setDrafts((current) => {
      const existing = current[variantId];
      if (!existing) return current;
      return { ...current, [variantId]: { ...existing, ...patch } };
    });
  }

  function dirtyVariantIds(): string[] {
    if (!variants) return [];
    return variants
      .filter((variant) => {
        const draft = drafts[variant.id];
        if (!draft) return false;
        const original = draftFromVariant(variant);
        return (
          draft.sku !== original.sku ||
          draft.name !== original.name ||
          draft.priceMinor !== original.priceMinor ||
          draft.currency !== original.currency
        );
      })
      .map((variant) => variant.id);
  }

  async function handleSaveAll() {
    setError(null);
    const dirtyIds = dirtyVariantIds();
    if (dirtyIds.length === 0) {
      return;
    }

    const parsedByVariantId = new Map<string, z.infer<typeof rowEditSchema>>();
    for (const variantId of dirtyIds) {
      const draft = drafts[variantId];
      if (!draft) continue;
      const parsed = rowEditSchema.safeParse({
        sku: draft.sku,
        name: draft.name,
        priceMinor: Number(draft.priceMinor),
        currency: draft.currency,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Invalid variant details.");
        return;
      }
      parsedByVariantId.set(variantId, parsed.data);
    }

    setSaving(true);
    try {
      for (const [variantId, patch] of parsedByVariantId) {
        const response = await fetch(`${API_BASE_URL}/listings/${listingId}/variants/${variantId}`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json", "x-merchant-id": merchantId },
          body: JSON.stringify(patch),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
          setError(body.detail ?? body.title ?? "Could not save a variant.");
          return;
        }
      }
      await loadVariants();
    } finally {
      setSaving(false);
    }
  }

  if (error === null && variants === null) {
    return (
      <main>
        <h1>Variants</h1>
        <p>Loading…</p>
      </main>
    );
  }

  const hasDirtyRows = dirtyVariantIds().length > 0;

  return (
    <main>
      <h1>Variants</h1>
      {error ? <p role="alert">{error}</p> : null}
      {variants && variants.length === 0 ? (
        <p>No variants on this listing yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Price (minor units)</th>
              <th>Currency</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {variants?.map((variant) => {
              const draft = drafts[variant.id] ?? draftFromVariant(variant);
              return (
                <tr key={variant.id}>
                  <td>
                    <TextField
                      label={`SKU for ${variant.id}`}
                      value={draft.sku}
                      onChange={(event) => updateDraft(variant.id, { sku: event.target.value })}
                    />
                  </td>
                  <td>
                    <TextField
                      label={`Name for ${variant.id}`}
                      value={draft.name}
                      onChange={(event) => updateDraft(variant.id, { name: event.target.value })}
                    />
                  </td>
                  <td>
                    <TextField
                      label={`Price for ${variant.id}`}
                      value={draft.priceMinor}
                      onChange={(event) => updateDraft(variant.id, { priceMinor: event.target.value })}
                    />
                  </td>
                  <td>
                    <TextField
                      label={`Currency for ${variant.id}`}
                      value={draft.currency}
                      onChange={(event) => updateDraft(variant.id, { currency: event.target.value })}
                    />
                  </td>
                  <td>
                    <Link href={`/dashboard/catalog/${listingId}/variants/${variant.id}/units?merchantId=${merchantId}`}>
                      Manage units
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Button onClick={handleSaveAll} disabled={saving || !hasDirtyRows}>
        Save changes
      </Button>
    </main>
  );
}
