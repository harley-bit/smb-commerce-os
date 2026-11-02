"use client";

import { useState } from "react";
import { z } from "zod";
import type { Listing, Variant } from "@smb-os/contracts";
import { Button, TextField } from "../../../components";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * These two schemas mirror the structural rules of `@smb-os/contracts`'s
 * `createListingInputSchema`/`createVariantInputSchema` (required fields,
 * an integer price, a non-empty currency) but are deliberately separate
 * objects, not an import of the real ones: `@smb-os/contracts`'s barrel
 * (`index.ts`) unconditionally re-exports `variant.ts`, which validates
 * price/currency through `@smb-os/domain`'s `Money.of` — and that package's
 * barrel pulls in `node:crypto` (for `generateUuidV7`) as a module-graph
 * side effect regardless of which export is actually used, which a
 * "use client" browser bundle can never include (confirmed by a real
 * `next build` failure — `UnhandledSchemeError: node:crypto` — before this
 * file was changed to stop importing any value from `@smb-os/contracts`,
 * only its erased-at-build `type` exports). This client-side copy exists
 * only to give the merchant fast, honest feedback before a round-trip —
 * `ListingService.create`/`VariantService.create`'s own field/price
 * validation (`packages/db`) is the real authority server-side and cannot
 * be bypassed by skipping this form (this card's security check).
 */
const listingDraftSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
});

const variantDraftSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  priceMinor: z.number().int(),
  currency: z.string().min(1),
});

interface VariantDraft {
  sku: string;
  name: string;
  priceMinor: string;
  currency: string;
}

const EMPTY_DRAFT: VariantDraft = { sku: "", name: "", priceMinor: "", currency: "" };

export interface ProductEditorProps {
  merchantId: string;
}

/**
 * `docs/cards/D106.md` — Listing editor: product. Every field this form
 * submits is checked against `listingDraftSchema`/`variantDraftSchema`
 * above before any fetch fires. A caller could still bypass this component
 * and post directly to the API, so `apps/api`'s own contract-schema parse
 * plus `ListingService`/`VariantService`'s field-level validation is the
 * real floor — this is a fast, honest client-side echo of it (this card's
 * security check).
 */
export function ProductEditor({ merchantId }: ProductEditorProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedListing, setSavedListing] = useState<Listing | null>(null);
  const [savedVariants, setSavedVariants] = useState<Variant[]>([]);

  function addVariantDraft() {
    setVariantDrafts((drafts) => [...drafts, { ...EMPTY_DRAFT }]);
  }

  function updateVariantDraft(index: number, patch: Partial<VariantDraft>) {
    setVariantDrafts((drafts) => drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  }

  async function handleSave() {
    setError(null);

    const listingDraft = listingDraftSchema.safeParse({
      name,
      slug,
      description: description || undefined,
    });
    if (!listingDraft.success) {
      setError(listingDraft.error.issues[0]?.message ?? "Invalid product details.");
      return;
    }
    const listingInputBody = {
      ...listingDraft.data,
      mode: "PRODUCT" as const,
      status: "DRAFT" as const,
      createdAt: new Date().toISOString(),
    };

    const variantInputs = [];
    for (const draft of variantDrafts) {
      const parsed = variantDraftSchema.safeParse({
        sku: draft.sku,
        name: draft.name,
        priceMinor: Number(draft.priceMinor),
        currency: draft.currency,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Invalid variant details.");
        return;
      }
      variantInputs.push(parsed.data);
    }

    setSaving(true);
    try {
      const listingResponse = await fetch(`${API_BASE_URL}/listings`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify(listingInputBody),
      });
      if (!listingResponse.ok) {
        const body = (await listingResponse.json().catch(() => ({}))) as { detail?: string; title?: string };
        setError(body.detail ?? body.title ?? "Could not save the product.");
        return;
      }
      const { id: listingId } = (await listingResponse.json()) as { id: string };

      for (const variantInput of variantInputs) {
        const variantResponse = await fetch(`${API_BASE_URL}/listings/${listingId}/variants`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", "x-merchant-id": merchantId },
          body: JSON.stringify({ ...variantInput, listingId }),
        });
        if (!variantResponse.ok) {
          const body = (await variantResponse.json().catch(() => ({}))) as { detail?: string; title?: string };
          setError(body.detail ?? body.title ?? "Could not save a variant.");
          return;
        }
      }

      const [listingReadBack, variantsReadBack] = await Promise.all([
        fetch(`${API_BASE_URL}/listings/${listingId}`, {
          credentials: "include",
          headers: { "x-merchant-id": merchantId },
        }),
        fetch(`${API_BASE_URL}/listings/${listingId}/variants`, {
          credentials: "include",
          headers: { "x-merchant-id": merchantId },
        }),
      ]);
      setSavedListing((await listingReadBack.json()) as Listing);
      setSavedVariants((await variantsReadBack.json()) as Variant[]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <h1>New product</h1>
      <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <TextField label="Slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
      <TextField
        label="Description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />

      <h2>Variants</h2>
      {variantDrafts.map((draft, index) => (
        <div key={index}>
          <TextField label="SKU" value={draft.sku} onChange={(event) => updateVariantDraft(index, { sku: event.target.value })} />
          <TextField
            label="Variant name"
            value={draft.name}
            onChange={(event) => updateVariantDraft(index, { name: event.target.value })}
          />
          <TextField
            label="Price (minor units)"
            value={draft.priceMinor}
            onChange={(event) => updateVariantDraft(index, { priceMinor: event.target.value })}
          />
          <TextField
            label="Currency"
            value={draft.currency}
            onChange={(event) => updateVariantDraft(index, { currency: event.target.value })}
          />
        </div>
      ))}
      <Button onClick={addVariantDraft}>Add variant</Button>

      <div>
        <Button onClick={handleSave} disabled={saving}>
          Save product
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      {savedListing ? (
        <section>
          <h2>Saved</h2>
          <p>{savedListing.name}</p>
          <ul>
            {savedVariants.map((variant) => (
              <li key={variant.id}>
                {variant.name} — {variant.priceMinor} {variant.currency}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
