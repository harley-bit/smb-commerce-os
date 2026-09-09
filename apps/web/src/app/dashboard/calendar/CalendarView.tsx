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
  /** `docs/cards/D127.md` — `null` unless the entry is currently `HELD`. */
  expiresAt: string | null;
}

const MODE_OPTIONS: readonly CalendarSubjectType[] = ["RESOURCE", "INVENTORY_UNIT"];

const EXPIRED_HOLD_MESSAGE = "This hold has expired. Please create a new booking.";

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { from: toDateInputValue(now), to: toDateInputValue(weekOut) };
}

/**
 * Mirrors `computeHoldCountdown` (`packages/domain/src/reservations/holdCountdown.ts`)
 * exactly — pure math, no `Date.now()` inside. Duplicated rather than
 * imported: `apps/web` has no dependency on `@smb-os/domain` (same
 * boundary `apps/web/src/auth/access.ts` documents for `MerchantRole`).
 */
function computeHoldCountdown(expiresAt: string, now: Date): { msRemaining: number; expired: boolean } {
  const msRemaining = Math.max(new Date(expiresAt).getTime() - now.getTime(), 0);
  return { msRemaining, expired: msRemaining <= 0 };
}

function formatRemaining(msRemaining: number): string {
  const totalSeconds = Math.ceil(msRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} remaining`;
}

interface HoldCellProps {
  merchantId: string;
  entry: CalendarEntry;
  onConfirmed: () => void;
}

/**
 * `docs/cards/D127.md` — the visible hold countdown, ticking every second
 * off `computeHoldCountdown` (`@smb-os/domain`, pure math, no `Date.now()`
 * inside). Once `expiresAt` is reached, this cell stops offering a way to
 * confirm the hold at all (`disabled`) rather than letting a click race the
 * server — the graceful client-side half of this card's acceptance
 * criterion. The server-side half is `POST /bookings/:id/confirm` throwing
 * `HoldExpiredError` (`ReservationRepository.confirm`) for the case this
 * client-side clock and the server's clock disagree, e.g. a hold that
 * expired between page load and the click: `confirmError` below renders
 * that 409's message exactly, never a raw error or a crash (this card's
 * security check — "prevents silent loss of a slot at payment time").
 */
function HoldCell({ merchantId, entry, onConfirmed }: HoldCellProps) {
  const [now, setNow] = useState(() => new Date());
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(interval);
  }, []);

  if (!entry.expiresAt) {
    return null;
  }

  const { msRemaining, expired } = computeHoldCountdown(entry.expiresAt, now);

  async function handleConfirm() {
    setConfirming(true);
    setConfirmError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/bookings/${entry.id}/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        setConfirmError(body.detail ?? "Could not confirm this booking.");
        return;
      }
      onConfirmed();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <span>{expired ? EXPIRED_HOLD_MESSAGE : formatRemaining(msRemaining)}</span>
      {entry.subjectType === "RESOURCE" && (
        <button type="button" onClick={() => void handleConfirm()} disabled={expired || confirming}>
          Confirm
        </button>
      )}
      {confirmError && <span role="alert">{confirmError}</span>}
    </>
  );
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
 *
 * `docs/cards/D127.md` extends this view with a "Hold" column: a live
 * countdown plus a Confirm action for each `HELD` entry (`HoldCell` above).
 */
export function CalendarView({ merchantId }: CalendarViewProps) {
  const [range, setRange] = useState(defaultRange);
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<CalendarSubjectType | "ALL">("ALL");
  const [refreshToken, setRefreshToken] = useState(0);

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
  }, [merchantId, range, refreshToken]);

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
              <th>Hold</th>
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
                <td>
                  {entry.state === "HELD" && (
                    <HoldCell
                      merchantId={merchantId}
                      entry={entry}
                      onConfirmed={() => setRefreshToken((token) => token + 1)}
                    />
                  )}
                </td>
                <td>{entry.hasConflict ? <span role="alert">Conflict</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
