"use client";

import { useEffect, useState } from "react";
import type { PublicRentalDetail } from "@smb-os/contracts";
import { TextField } from "../../../../../components";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface RentalDetailViewProps {
  slug: string;
  listingSlug: string;
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

/**
 * `docs/cards/D124.md` — the rental listing detail page: date-range picker
 * plus deposit disclosure. Reads `apps/api/src/routes/publicStorefront.ts`'s
 * unauthenticated `GET /v1/m/{slug}/listings/{listingSlug}` for the rental's
 * variant(s), then, once both dates are picked, its sibling
 * `GET .../rental-availability` for a bare `available` boolean.
 *
 * Deposit disclosure (this card's security check, "Deposit disclosed before
 * any commitment") is unconditional: the deposit line renders as soon as
 * the listing loads, above and independent of the date-range picker — a
 * visitor sees it before they can enter a single date, let alone select a
 * range. "Unavailable ranges blocked" (this card's acceptance criterion)
 * holds structurally, the same way D123's slot picker does: a "Reserve"
 * button for the entered range only ever renders once the availability
 * check has come back `true`; an unavailable range renders a message
 * instead, never a selectable control.
 *
 * Only ever checks/books against `variants[0]`, the same single-variant
 * deviation `ServiceDetailView` (D123) already made for
 * `resourceIds[0]` — a rental listing with more than one variant is out of
 * this card's scope.
 */
export function RentalDetailView({ slug, listingSlug }: RentalDetailViewProps) {
  const [detail, setDetail] = useState<PublicRentalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [selected, setSelected] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`${API_BASE_URL}/v1/m/${slug}/listings/${listingSlug}`);
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not find that rental.");
        return;
      }
      setDetail((await response.json()) as PublicRentalDetail);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, listingSlug]);

  const variant = detail?.variants[0];

  useEffect(() => {
    setSelected(false);
    if (!variant || !startDate || !endDate) {
      setAvailable(null);
      setRangeError(null);
      return;
    }
    const from = `${startDate}T00:00:00.000Z`;
    const to = `${endDate}T00:00:00.000Z`;
    if (to <= from) {
      setAvailable(null);
      setRangeError("The end date must be after the start date.");
      return;
    }
    setRangeError(null);
    let cancelled = false;
    async function checkAvailability() {
      const response = await fetch(
        `${API_BASE_URL}/v1/m/${slug}/listings/${listingSlug}/rental-availability?variantId=${variant!.id}&from=${from}&to=${to}`,
      );
      if (cancelled) return;
      if (!response.ok) {
        setAvailable(null);
        return;
      }
      const body = (await response.json()) as { available: boolean };
      setAvailable(body.available);
    }
    void checkAvailability();
    return () => {
      cancelled = true;
    };
  }, [slug, listingSlug, variant, startDate, endDate]);

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
      {!variant ? (
        <p>No rental options available.</p>
      ) : (
        <>
          <p>
            {formatMinor(variant.priceMinor, variant.currency)} per {variant.ratePeriod?.toLowerCase() ?? "period"} —{" "}
            {variant.depositMinor === null
              ? "no deposit required"
              : `refundable deposit of ${formatMinor(variant.depositMinor, variant.currency)}`}
          </p>
          <div>
            <TextField
              label="Start date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            <TextField
              label="End date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              error={rangeError ?? undefined}
            />
          </div>
          {available === false && <p>That date range is not available. Please choose another.</p>}
          {available === true && (
            <button type="button" aria-pressed={selected} onClick={() => setSelected(true)}>
              Reserve {startDate} – {endDate}
            </button>
          )}
        </>
      )}
    </main>
  );
}
