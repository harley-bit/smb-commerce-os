"use client";

import { useEffect, useState } from "react";
import type { PublicServiceDetail } from "@smb-os/contracts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const AVAILABILITY_WINDOW_DAYS = 14;

interface FreeInterval {
  start: string;
  end: string;
}

export interface ServiceDetailViewProps {
  slug: string;
  listingSlug: string;
}

/**
 * Deterministic, timezone-independent label — deliberately not
 * `Intl.DateTimeFormat` (whose output depends on the browser/test
 * runner's local zone), since `start`/`end` are already UTC ISO instants
 * (`packages/domain/src/utils/interval.ts`). `2026-09-10 09:00–10:00 UTC`.
 */
function formatSlotLabel(interval: FreeInterval): string {
  const startLabel = interval.start.replace("T", " ").slice(0, 16);
  const endLabel = interval.end.slice(11, 16);
  return `${startLabel}–${endLabel} UTC`;
}

/**
 * `docs/cards/D123.md` — the service listing detail page and slot picker.
 * Reads `apps/api/src/routes/publicStorefront.ts`'s `GET
 * /v1/m/{slug}/listings/{listingSlug}` for the listing plus its
 * `resourceIds`, then `GET /v1/m/{slug}/availability` (`./availability.ts`)
 * for the first assigned resource's free intervals over the next
 * `AVAILABILITY_WINDOW_DAYS` days. This card's acceptance criterion — "Only
 * free slots selectable" — holds structurally: the availability response's
 * `free: Interval[]` never carries a busy interval at all
 * (`computeFreeIntervals`'s doc comment), so every button this view renders
 * is already free; there is no busy slot to disable. This card's security
 * check — "Availability shows free/busy only, never who booked" — holds for
 * the same reason one layer down: `Interval` carries only `start`/`end`,
 * never a reservation id or customer name.
 */
export function ServiceDetailView({ slug, listingSlug }: ServiceDetailViewProps) {
  const [detail, setDetail] = useState<PublicServiceDetail | null>(null);
  const [free, setFree] = useState<FreeInterval[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`${API_BASE_URL}/v1/m/${slug}/listings/${listingSlug}`);
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not find that service.");
        return;
      }
      const loadedDetail = (await response.json()) as PublicServiceDetail;
      setDetail(loadedDetail);

      const resourceId = loadedDetail.resourceIds[0];
      if (!resourceId) {
        setFree([]);
        return;
      }

      const from = new Date().toISOString();
      const to = new Date(Date.now() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const availabilityResponse = await fetch(
        `${API_BASE_URL}/v1/m/${slug}/availability?resourceId=${resourceId}&from=${from}&to=${to}`,
      );
      if (cancelled) return;
      if (!availabilityResponse.ok) {
        setFree([]);
        return;
      }
      const body = (await availabilityResponse.json()) as { free: FreeInterval[] };
      setFree(body.free);
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

  if (!detail || free === null) {
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
      {free.length === 0 ? (
        <p>No slots available right now.</p>
      ) : (
        <ul>
          {free.map((interval, index) => (
            <li key={`${interval.start}-${interval.end}`}>
              <button type="button" aria-pressed={selectedIndex === index} onClick={() => setSelectedIndex(index)}>
                {formatSlotLabel(interval)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
