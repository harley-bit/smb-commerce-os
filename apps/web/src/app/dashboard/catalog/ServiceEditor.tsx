"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import type { Listing, Resource, Variant } from "@smb-os/contracts";
import { Button, TextField } from "../../../components";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Same posture as `ProductEditor.tsx`'s `listingDraftSchema`/`variantDraftSchema`
 * — a structural mirror of `@smb-os/contracts`'s Zod schemas, not an import
 * of them, so this "use client" bundle never pulls in `@smb-os/domain`'s
 * `node:crypto` dependency (`docs/logs/D106.md`). The real authority is
 * still `ListingService`/`VariantService`/`ResourceService`'s server-side
 * validation — this is a fast, honest echo of it.
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
  durationMinutes: z.number().int().positive(),
});

export interface ServiceEditorProps {
  merchantId: string;
}

/**
 * `docs/cards/D107.md` — Listing editor: service. Deliverable: "SERVICE
 * listings: duration, resources, policy." A SERVICE listing's "duration" is
 * its single variant's `durationMinutes` (`@smb-os/contracts`'s
 * `createVariantInputSchema`, services-only field); "resources" is which of
 * the merchant's already-created `resources` (D058) can fulfil it, assigned
 * through D107's new `listing_resources` join
 * (`POST /listings/:listingId/resources`) — this component only assigns an
 * *existing* resource (fetched via `GET /resources`), it does not create
 * one; there is no location-picker UI yet for a resource-creation form to
 * use (same carried-forward gap D104/D105 flagged for merchant-switching).
 * "Policy" (per-listing cancellation policy) is not persisted anywhere in
 * this codebase yet (`docs/logs/D096.md`'s open gap, unchanged) — out of
 * this card's scope; the per-mode `CancellationPolicySet` referenced there
 * governs refunds structurally regardless of what this form saves.
 *
 * Acceptance criterion ("service bookable after save") is proved by
 * `apps/api/test/resources.test.ts`'s end-to-end case, not by this
 * component — a real booking flow (calendar, customer-facing checkout)
 * isn't in scope here; this editor's job is only that the save produces a
 * listing/variant/resource-assignment combination that flow can act on.
 */
export function ServiceEditor({ merchantId }: ServiceEditorProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [variantName, setVariantName] = useState("");
  const [priceMinor, setPriceMinor] = useState("");
  const [currency, setCurrency] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [availableResources, setAvailableResources] = useState<Resource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedListing, setSavedListing] = useState<Listing | null>(null);
  const [savedVariant, setSavedVariant] = useState<Variant | null>(null);
  const [savedResource, setSavedResource] = useState<Resource | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/resources`, { credentials: "include", headers: { "x-merchant-id": merchantId } })
      .then((res) => (res.ok ? (res.json() as Promise<Resource[]>) : []))
      .then((resources) => setAvailableResources(resources))
      .catch(() => setAvailableResources([]));
  }, [merchantId]);

  async function handleSave() {
    setError(null);

    const listingDraft = listingDraftSchema.safeParse({
      name,
      slug,
      description: description || undefined,
    });
    if (!listingDraft.success) {
      setError(listingDraft.error.issues[0]?.message ?? "Invalid service details.");
      return;
    }

    const variantDraft = variantDraftSchema.safeParse({
      sku,
      name: variantName,
      priceMinor: Number(priceMinor),
      currency,
      durationMinutes: Number(durationMinutes),
    });
    if (!variantDraft.success) {
      setError(variantDraft.error.issues[0]?.message ?? "Invalid duration/price details.");
      return;
    }

    if (!selectedResourceId) {
      setError("Choose a resource to fulfil this service.");
      return;
    }

    setSaving(true);
    try {
      const listingInputBody = {
        ...listingDraft.data,
        mode: "SERVICE" as const,
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
        setError(body.detail ?? body.title ?? "Could not save the service.");
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
        setError(body.detail ?? body.title ?? "Could not save the duration/price.");
        return;
      }

      const assignResponse = await fetch(`${API_BASE_URL}/listings/${listingId}/resources`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({ resourceId: selectedResourceId }),
      });
      if (!assignResponse.ok) {
        const body = (await assignResponse.json().catch(() => ({}))) as { detail?: string; title?: string };
        setError(body.detail ?? body.title ?? "Could not assign the resource.");
        return;
      }

      const [listingReadBack, variantsReadBack, resourcesReadBack] = await Promise.all([
        fetch(`${API_BASE_URL}/listings/${listingId}`, {
          credentials: "include",
          headers: { "x-merchant-id": merchantId },
        }),
        fetch(`${API_BASE_URL}/listings/${listingId}/variants`, {
          credentials: "include",
          headers: { "x-merchant-id": merchantId },
        }),
        fetch(`${API_BASE_URL}/listings/${listingId}/resources`, {
          credentials: "include",
          headers: { "x-merchant-id": merchantId },
        }),
      ]);
      setSavedListing((await listingReadBack.json()) as Listing);
      const variants = (await variantsReadBack.json()) as Variant[];
      setSavedVariant(variants[0] ?? null);
      const assignments = (await resourcesReadBack.json()) as { resourceId: string }[];
      const assignedResource =
        availableResources.find((resource) => resource.id === assignments[0]?.resourceId) ?? null;
      setSavedResource(assignedResource);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <h1>New service</h1>
      <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <TextField label="Slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
      <TextField
        label="Description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />

      <h2>Duration &amp; price</h2>
      <TextField label="SKU" value={sku} onChange={(event) => setSku(event.target.value)} />
      <TextField label="Variant name" value={variantName} onChange={(event) => setVariantName(event.target.value)} />
      <TextField
        label="Price (minor units)"
        value={priceMinor}
        onChange={(event) => setPriceMinor(event.target.value)}
      />
      <TextField label="Currency" value={currency} onChange={(event) => setCurrency(event.target.value)} />
      <TextField
        label="Duration (minutes)"
        value={durationMinutes}
        onChange={(event) => setDurationMinutes(event.target.value)}
      />

      <h2>Resource</h2>
      <label>
        Fulfilled by
        <select value={selectedResourceId} onChange={(event) => setSelectedResourceId(event.target.value)}>
          <option value="">Select a resource…</option>
          {availableResources.map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.name} ({resource.kind})
            </option>
          ))}
        </select>
      </label>

      <div>
        <Button onClick={handleSave} disabled={saving}>
          Save service
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      {savedListing ? (
        <section>
          <h2>Saved</h2>
          <p>{savedListing.name}</p>
          {savedVariant ? (
            <p>
              {savedVariant.name} — {savedVariant.durationMinutes} min — {savedVariant.priceMinor}{" "}
              {savedVariant.currency}
            </p>
          ) : null}
          {savedResource ? <p>Fulfilled by: {savedResource.name}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
