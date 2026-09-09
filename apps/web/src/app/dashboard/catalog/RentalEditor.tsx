"use client";

import { useState } from "react";
import { z } from "zod";
import type { Listing, Variant } from "@smb-os/contracts";
import { Button, TextField } from "../../../components";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * `packages/domain/src/payments/authorizationWindow.ts`'s
 * `AUTHORIZATION_WINDOW_CEILING_DAYS` — duplicated here, not imported, for
 * the same reason `ProductEditor.tsx`/`ServiceEditor.tsx` keep their own
 * structural mirrors of `@smb-os/contracts`'s schemas rather than importing
 * them: any value import from `@smb-os/domain` pulls in `node:crypto` as a
 * module-graph side effect, which a "use client" browser bundle can never
 * include (`docs/logs/D106.md`). This card's security check ("window-ceiling
 * warning shown for long rental terms") is this constant plus the check
 * below — `docs/design/05`'s C4 rule: a rental term longer than the
 * provider's authorization window cannot rely on a hold and needs a
 * captured deposit or a contractual claims process instead. The real,
 * throwing enforcement of this ceiling lives server-side in
 * `recordProviderAuthorizationWindow`/`validateRentalTermAgainstAuthorizationWindow`
 * (`packages/domain`) — this is an advisory echo at configuration time, not
 * a substitute for it.
 */
const AUTHORIZATION_WINDOW_CEILING_DAYS = 30;

/**
 * Same posture as `ProductEditor.tsx`'s `listingDraftSchema`/`variantDraftSchema`
 * — a structural mirror of `@smb-os/contracts`'s Zod schemas, not an import
 * of them. `ratePeriod` mirrors `variantRatePeriodSchema`;
 * `depositMinor`/`bufferMinutes` mirror the RENTAL-only fields
 * `createVariantInputSchema` accepts.
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
  ratePeriod: z.enum(["HOUR", "DAY", "WEEK"]),
  depositMinor: z.number().int().nonnegative(),
  bufferMinutes: z.number().int().nonnegative(),
});

export interface RentalEditorProps {
  merchantId: string;
}

/**
 * `docs/cards/D108.md` — Listing editor: rental. Deliverable: "RENTAL
 * listings: rate period, deposit, buffer." Acceptance criterion ("deposit
 * and buffer persist and apply") is proved end-to-end by
 * `apps/api/test/rentals.test.ts`, not by this component: a RENTAL variant
 * saved through the exact `POST /listings`/`POST /listings/:listingId/variants`
 * routes this editor calls drives a real buffer-expanded reservation
 * (`RentalReservationService`) and a real deposit hold for the exact
 * configured amount (`DepositAuthorizationService`). This component's job
 * is only that the save produces a listing/variant combination those
 * services can act on, and that it renders the server's own read-back —
 * mirroring `ProductEditor.tsx`/`ServiceEditor.tsx`'s save-then-render-back
 * pattern exactly.
 *
 * "Typical rental term (days)" is a UI-only field: it is never sent to the
 * server (no such column exists on `listing_variants` — a term is a
 * property of a specific booking's start/end, not the catalog item), it
 * only drives the window-ceiling warning below.
 */
export function RentalEditor({ merchantId }: RentalEditorProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [variantName, setVariantName] = useState("");
  const [priceMinor, setPriceMinor] = useState("");
  const [currency, setCurrency] = useState("");
  const [ratePeriod, setRatePeriod] = useState<"HOUR" | "DAY" | "WEEK">("DAY");
  const [depositMinor, setDepositMinor] = useState("");
  const [bufferMinutes, setBufferMinutes] = useState("");
  const [typicalTermDays, setTypicalTermDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedListing, setSavedListing] = useState<Listing | null>(null);
  const [savedVariant, setSavedVariant] = useState<Variant | null>(null);

  const parsedTermDays = Number(typicalTermDays);
  const showWindowCeilingWarning =
    typicalTermDays !== "" && Number.isFinite(parsedTermDays) && parsedTermDays > AUTHORIZATION_WINDOW_CEILING_DAYS;

  async function handleSave() {
    setError(null);

    const listingDraft = listingDraftSchema.safeParse({
      name,
      slug,
      description: description || undefined,
    });
    if (!listingDraft.success) {
      setError(listingDraft.error.issues[0]?.message ?? "Invalid rental details.");
      return;
    }

    const variantDraft = variantDraftSchema.safeParse({
      sku,
      name: variantName,
      priceMinor: Number(priceMinor),
      currency,
      ratePeriod,
      depositMinor: Number(depositMinor),
      bufferMinutes: Number(bufferMinutes),
    });
    if (!variantDraft.success) {
      setError(variantDraft.error.issues[0]?.message ?? "Invalid rate/deposit/buffer details.");
      return;
    }

    setSaving(true);
    try {
      const listingInputBody = {
        ...listingDraft.data,
        mode: "RENTAL" as const,
        status: "DRAFT" as const,
        createdAt: new Date().toISOString(),
      };
      const listingResponse = await fetch(`${API_BASE_URL}/listings`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify(listingInputBody),
      });
      if (!listingResponse.ok) {
        const body = (await listingResponse.json().catch(() => ({}))) as { detail?: string; title?: string };
        setError(body.detail ?? body.title ?? "Could not save the rental listing.");
        return;
      }
      const { id: listingId } = (await listingResponse.json()) as { id: string };

      const variantResponse = await fetch(`${API_BASE_URL}/listings/${listingId}/variants`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify(variantDraft.data),
      });
      if (!variantResponse.ok) {
        const body = (await variantResponse.json().catch(() => ({}))) as { detail?: string; title?: string };
        setError(body.detail ?? body.title ?? "Could not save the rate/deposit/buffer.");
        return;
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
      const variants = (await variantsReadBack.json()) as Variant[];
      setSavedVariant(variants[0] ?? null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <h1>New rental</h1>
      <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <TextField label="Slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
      <TextField
        label="Description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />

      <h2>Rate, deposit &amp; buffer</h2>
      <TextField label="SKU" value={sku} onChange={(event) => setSku(event.target.value)} />
      <TextField label="Variant name" value={variantName} onChange={(event) => setVariantName(event.target.value)} />
      <TextField
        label="Price (minor units)"
        value={priceMinor}
        onChange={(event) => setPriceMinor(event.target.value)}
      />
      <TextField label="Currency" value={currency} onChange={(event) => setCurrency(event.target.value)} />
      <label>
        Rate period
        <select value={ratePeriod} onChange={(event) => setRatePeriod(event.target.value as "HOUR" | "DAY" | "WEEK")}>
          <option value="HOUR">Hour</option>
          <option value="DAY">Day</option>
          <option value="WEEK">Week</option>
        </select>
      </label>
      <TextField
        label="Deposit (minor units)"
        value={depositMinor}
        onChange={(event) => setDepositMinor(event.target.value)}
      />
      <TextField
        label="Turnaround buffer (minutes)"
        value={bufferMinutes}
        onChange={(event) => setBufferMinutes(event.target.value)}
      />

      <h2>Rental term</h2>
      <TextField
        label="Typical rental term (days)"
        value={typicalTermDays}
        onChange={(event) => setTypicalTermDays(event.target.value)}
      />
      {showWindowCeilingWarning ? (
        <p role="status">
          A rental term of {parsedTermDays} day(s) exceeds the {AUTHORIZATION_WINDOW_CEILING_DAYS}-day payment
          authorization hold window. A hold cannot cover this rental — use a captured deposit up front or a
          contractual claims process instead.
        </p>
      ) : null}

      <div>
        <Button onClick={handleSave} disabled={saving}>
          Save rental
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      {savedListing ? (
        <section>
          <h2>Saved</h2>
          <p>{savedListing.name}</p>
          {savedVariant ? (
            <p>
              {savedVariant.name} — {savedVariant.priceMinor} {savedVariant.currency} / {savedVariant.ratePeriod} —
              deposit {savedVariant.depositMinor} — buffer {savedVariant.bufferMinutes} min
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
