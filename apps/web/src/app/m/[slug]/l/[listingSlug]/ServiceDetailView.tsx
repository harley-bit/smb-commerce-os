"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicServiceDetail } from "@smb-os/contracts";
import { computeMonthWindow, monthLabel } from "./availabilityWindow";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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
 * `docs/cards/D123.md` — the service listing detail page and slot picker,
 * extended by `docs/cards/D125.md` with month navigation. Reads
 * `apps/api/src/routes/publicStorefront.ts`'s `GET
 * /v1/m/{slug}/listings/{listingSlug}` for the listing plus its
 * `resourceIds`, then `GET /v1/m/{slug}/availability` (`./availability.ts`)
 * for the first assigned resource's free intervals over the page's window
 * (`./availabilityWindow.ts`'s `computeMonthWindow`). This card's
 * acceptance criterion — "Matches server availability exactly" — holds
 * because `free` is rendered verbatim from the response, never filtered or
 * recomputed client-side. D123's "Only free slots selectable" still holds
 * structurally: the availability response's `free: Interval[]` never
 * carries a busy interval at all (`computeFreeIntervals`'s doc comment), so
 * every button this view renders is already free. D123's security check —
 * "Availability shows free/busy only, never who booked" — holds for the
 * same reason one layer down: `Interval` carries only `start`/`end`, never
 * a reservation id or customer name.
 *
 * This card's own security check — "90-day request cap respected by the
 * client" — is `computeMonthWindow`'s job: `to` is always clamped at `now +
 * 90 days` (mirroring `AvailabilityService`'s own cap), and "Next month"
 * disables itself the moment a further page would cross that cap, so this
 * view never issues a request the server would reject anyway.
 */
export function ServiceDetailView({ slug, listingSlug }: ServiceDetailViewProps) {
  const [detail, setDetail] = useState<PublicServiceDetail | null>(null);
  const [free, setFree] = useState<FreeInterval[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monthsAhead, setMonthsAhead] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`${API_BASE_URL}/v1/m/${slug}/listings/${listingSlug}`);
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not find that service.");
        return;
      }
      setDetail((await response.json()) as PublicServiceDetail);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, listingSlug]);

  const resourceId = detail?.resourceIds[0];
  const monthWindow = useMemo(() => computeMonthWindow(new Date(), monthsAhead), [monthsAhead]);

  useEffect(() => {
    if (!detail) return;
    setSelectedIndex(null);
    if (!resourceId) {
      setFree([]);
      return;
    }
    let cancelled = false;
    async function loadAvailability() {
      const response = await fetch(
        `${API_BASE_URL}/v1/m/${slug}/availability?resourceId=${resourceId}&from=${monthWindow.from}&to=${monthWindow.to}`,
      );
      if (cancelled) return;
      if (!response.ok) {
        setFree([]);
        return;
      }
      const body = (await response.json()) as { free: FreeInterval[] };
      setFree(body.free);
    }
    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [detail, resourceId, slug, monthWindow.from, monthWindow.to]);

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
      {resourceId && (
        <div>
          <button
            type="button"
            onClick={() => setMonthsAhead((current) => current - 1)}
            disabled={monthsAhead === 0}
          >
            Previous month
          </button>
          <span>{monthLabel(monthWindow.windowStart)}</span>
          <button
            type="button"
            onClick={() => setMonthsAhead((current) => current + 1)}
            disabled={!monthWindow.canGoNext}
          >
            Next month
          </button>
        </div>
      )}
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
