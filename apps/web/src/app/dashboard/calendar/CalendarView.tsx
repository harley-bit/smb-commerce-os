"use client";

import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type CalendarSubjectType = "RESOURCE" | "INVENTORY_UNIT";

interface CalendarEntry {
  id: string;
  subjectType: CalendarSubjectType;
  subjectId: string;
  subjectLabel: string;
  startsAt: string;
  endsAt: string;
  state: string;
  orderLineId: string | null;
  hasConflict: boolean;
}

const MODE_OPTIONS: readonly CalendarSubjectType[] = ["RESOURCE", "INVENTORY_UNIT"];

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { from: toDateInputValue(now), to: toDateInputValue(weekOut) };
}

export interface CalendarViewProps {
  merchantId: string;
}

/**
 * `docs/cards/D114.md` — Unified calendar. Renders `GET /calendar`
 * (`apps/api/src/routes/calendar.ts`) — already merchant-scoped through
 * `CalendarService`/`ReservationRepository`'s `TenantScopedRepository`
 * base — the same `X-Merchant-Id`-header pattern `CatalogView`/
 * `PaymentsView` established. `hasConflict` (computed server-side) drives
 * the "Conflict" badge; this view never re-derives it client-side.
 */
export function CalendarView({ merchantId }: CalendarViewProps) {
  const [range, setRange] = useState(defaultRange);
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<CalendarSubjectType | "ALL">("ALL");

  useEffect(() => {
    let cancelled = false;
    async function loadCalendar() {
      const rangeStart = `${range.from}T00:00:00.000Z`;
      const rangeEnd = `${range.to}T23:59:59.999Z`;
      const response = await fetch(
        `${API_BASE_URL}/calendar?rangeStart=${encodeURIComponent(rangeStart)}&rangeEnd=${encodeURIComponent(rangeEnd)}`,
        {
          credentials: "include",
          headers: { "x-merchant-id": merchantId },
        },
      );
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not load the calendar.");
        return;
      }
      setEntries((await response.json()) as CalendarEntry[]);
    }
    void loadCalendar();
    return () => {
      cancelled = true;
    };
  }, [merchantId, range]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    return entries.filter((entry) => modeFilter === "ALL" || entry.subjectType === modeFilter);
  }, [entries, modeFilter]);

  if (error) {
    return (
      <main>
        <h1>Calendar</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Calendar</h1>
      <div>
        <label htmlFor="calendar-from">From</label>
        <input
          id="calendar-from"
          type="date"
          value={range.from}
          onChange={(event) => setRange((prev) => ({ ...prev, from: event.target.value }))}
        />
        <label htmlFor="calendar-to">To</label>
        <input
          id="calendar-to"
          type="date"
          value={range.to}
          onChange={(event) => setRange((prev) => ({ ...prev, to: event.target.value }))}
        />
        <label htmlFor="calendar-mode-filter">Mode</label>
        <select
          id="calendar-mode-filter"
          value={modeFilter}
          onChange={(event) => setModeFilter(event.target.value as CalendarSubjectType | "ALL")}
        >
          <option value="ALL">All modes</option>
          {MODE_OPTIONS.map((mode) => (
            <option key={mode} value={mode}>
              {mode === "RESOURCE" ? "Bookings" : "Rentals"}
            </option>
          ))}
        </select>
      </div>
      {entries === null ? (
        <p>Loading…</p>
      ) : filtered.length === 0 ? (
        <p>No bookings or rentals match the current filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Starts</th>
              <th>Ends</th>
              <th>Subject</th>
              <th>Mode</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id} className={entry.hasConflict ? "calendar-row--conflict" : undefined}>
                <td>{entry.startsAt}</td>
                <td>{entry.endsAt}</td>
                <td>{entry.subjectLabel}</td>
                <td>{entry.subjectType === "RESOURCE" ? "Booking" : "Rental"}</td>
                <td>{entry.state}</td>
                <td>{entry.hasConflict ? <span role="alert">Conflict</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
