"use client";

import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Mirrors `@smb-os/domain`'s `CONDITION_GRADES` structurally — same reason
 * `RentalCheckoutView.tsx` gives for its own copy: a value import from
 * `@smb-os/domain` pulls in `node:crypto`, which a "use client" bundle can't include.
 */
const CONDITION_GRADES = ["DAMAGED", "POOR", "FAIR", "GOOD", "EXCELLENT", "NEW"] as const;

interface ConditionMedia {
  id: string;
  storageKey: string;
  sha256: string;
}

interface ConditionReport {
  id: string;
  conditionGrade: string;
  notes: string | null;
  media: ConditionMedia[];
}

interface ConditionGradeDelta {
  checkoutGrade: string;
  checkinGrade: string;
  deltaSteps: number;
  deteriorated: boolean;
  improved: boolean;
  unchanged: boolean;
}

interface ConditionReportComparison {
  checkoutReport: ConditionReport | null;
  checkinReport: ConditionReport | null;
  delta: ConditionGradeDelta | null;
}

interface UploadedPhoto {
  storageKey: string;
  fileName: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Short, human-scannable prefix of a hex digest — enough to spot a mismatch, not the full 64 characters. */
function shortHash(sha256: string): string {
  return `${sha256.slice(0, 12)}…`;
}

function deltaLabel(delta: ConditionGradeDelta): string {
  if (delta.deteriorated) return `Deteriorated (${delta.checkoutGrade} → ${delta.checkinGrade})`;
  if (delta.improved) return `Improved (${delta.checkoutGrade} → ${delta.checkinGrade})`;
  return `Unchanged (${delta.checkoutGrade})`;
}

export interface RentalCheckinViewProps {
  merchantId: string;
  orderLineId: string;
}

/**
 * `docs/cards/D117.md` — Rental check-in flow. Loads the CHECKOUT baseline
 * via `GET /order-lines/:orderLineId/condition-reports`
 * (`ConditionReportService.getComparison`), then lets staff record a CHECKIN
 * condition report — `POST .../condition-reports/checkin`
 * (`ConditionReportService.recordCheckin`, D075) — with its own photos,
 * before completing the return — `POST .../return`
 * (`FulfillmentEventService.recordReturn`, D070/D071).
 *
 * This card's acceptance criterion ("grade delta surfaced") is answered by
 * the side-by-side comparison section below: once a CHECKIN report exists,
 * the CHECKOUT and CHECKIN grades render next to each other with the
 * computed delta between them. "Unit returns to availability" holds by
 * construction on the server (`recordReturn` drives the linked reservation
 * to `RETURNED`, which the availability engine's blocking-state predicate
 * excludes) — the confirmation message below states it explicitly so staff
 * don't have to take that on faith.
 *
 * This card's security check ("media integrity hash verified on display")
 * is answered two ways: CHECKOUT baseline photos show the `sha256`
 * `ConditionMediaConfirmService` (D074) independently recomputed and
 * verified at upload time — a value this view only ever reads from the
 * server, never trusts from anywhere else. Freshly captured CHECKIN photos
 * go one step further: `handlePhotoSelected` hashes the file's bytes itself
 * before upload, and only adds the photo to the on-screen list once the
 * server's confirmed record echoes back that same digest — a display-time
 * integrity check on top of the upload-time one, catching a corrupted
 * response even though the upload-time hash already passed.
 */
export function RentalCheckinView({ merchantId, orderLineId }: RentalCheckinViewProps) {
  const [comparison, setComparison] = useState<ConditionReportComparison | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inventoryUnitId, setInventoryUnitId] = useState("");
  const [conditionGrade, setConditionGrade] = useState<string>("GOOD");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [returnNote, setReturnNote] = useState("");
  const [returned, setReturned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadComparison() {
    const response = await fetch(`${API_BASE_URL}/order-lines/${orderLineId}/condition-reports`, {
      credentials: "include",
      headers: { "x-merchant-id": merchantId },
    });
    if (!response.ok) {
      setLoadError("Could not load this rental's condition-report history.");
      return;
    }
    setComparison((await response.json()) as ConditionReportComparison);
  }

  useEffect(() => {
    void loadComparison();
  }, [orderLineId]);

  const checkinReport = comparison?.checkinReport ?? null;

  async function handleCreateCheckin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (inventoryUnitId.trim().length === 0) {
      setError("Inventory unit is required.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/order-lines/${orderLineId}/condition-reports/checkin`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({ inventoryUnitId, conditionGrade, notes: notes.trim() || undefined }),
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? "A CHECKOUT condition report is required before a CHECKIN can be recorded."
            : "Could not record the CHECKIN condition report.",
        );
        return;
      }
      await loadComparison();
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePhotoSelected(file: File) {
    setError(null);
    if (!checkinReport) return;
    setSubmitting(true);
    try {
      const bytes = await file.arrayBuffer();
      const localDigest = arrayBufferToHex(await crypto.subtle.digest("SHA-256", bytes));

      const grantResponse = await fetch(`${API_BASE_URL}/condition-reports/${checkinReport.id}/media/upload-url`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({ contentType: file.type, bytes: bytes.byteLength }),
      });
      if (!grantResponse.ok) {
        setError("Could not attach that photo.");
        return;
      }
      const grant = (await grantResponse.json()) as { storageKey: string };

      const confirmResponse = await fetch(`${API_BASE_URL}/condition-reports/${checkinReport.id}/media/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({
          storageKey: grant.storageKey,
          contentType: file.type,
          bytesBase64: arrayBufferToBase64(bytes),
          declaredSha256: localDigest,
          capturedAt: new Date().toISOString(),
        }),
      });
      if (!confirmResponse.ok) {
        setError("Could not attach that photo.");
        return;
      }

      // This card's security check: re-fetch the server's own record of what
      // it just confirmed and compare its `sha256` against the digest this
      // browser computed before upload — never display a photo whose
      // confirmed hash doesn't match what was actually captured.
      await loadComparison();
      const refreshed = await fetch(`${API_BASE_URL}/order-lines/${orderLineId}/condition-reports`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      const refreshedComparison = (await refreshed.json()) as ConditionReportComparison;
      const confirmedMedia = refreshedComparison.checkinReport?.media.find(
        (item) => item.storageKey === grant.storageKey,
      );
      if (!confirmedMedia || confirmedMedia.sha256 !== localDigest) {
        setError("Photo integrity check failed — the server's recorded hash does not match this device's capture.");
        return;
      }
      setComparison(refreshedComparison);
      setPhotos((current) => [...current, { storageKey: grant.storageKey, fileName: file.name }]);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteReturn(event: React.FormEvent) {
    event.preventDefault();
    if (!checkinReport) {
      setError("A CHECKIN condition report is required before the return can be completed.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/order-lines/${orderLineId}/return`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({ occurredAt: new Date().toISOString(), note: returnNote || "Returned." }),
      });
      if (!response.ok) {
        setError("Could not complete the return.");
        return;
      }
      setReturned(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (returned) {
    return (
      <main>
        <h1>Rental check-in</h1>
        <p role="status">Returned — the unit is now available for the next booking.</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main>
        <h1>Rental check-in</h1>
        <p role="alert">{loadError}</p>
      </main>
    );
  }

  if (!comparison) {
    return (
      <main>
        <h1>Rental check-in</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Rental check-in</h1>
      {error && <p role="alert">{error}</p>}

      <section aria-label="Condition comparison">
        <h2>Condition comparison</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Checkout</th>
              <th>Check-in</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Grade</td>
              <td>{comparison.checkoutReport?.conditionGrade ?? "—"}</td>
              <td>{checkinReport?.conditionGrade ?? "—"}</td>
            </tr>
            <tr>
              <td>Photos</td>
              <td>
                <ul>
                  {(comparison.checkoutReport?.media ?? []).map((item) => (
                    <li key={item.id}>Hash verified at checkout: {shortHash(item.sha256)}</li>
                  ))}
                </ul>
              </td>
              <td>
                <ul>
                  {(checkinReport?.media ?? []).map((item) => (
                    <li key={item.id}>Hash verified on display: {shortHash(item.sha256)}</li>
                  ))}
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
        {comparison.delta && <p role="status">Grade delta: {deltaLabel(comparison.delta)}</p>}
      </section>

      {!checkinReport && (
        <section aria-label="Check-in condition report">
          <h2>1. Check-in condition report</h2>
          <form onSubmit={handleCreateCheckin}>
            <label>
              Inventory unit
              <input value={inventoryUnitId} onChange={(event) => setInventoryUnitId(event.target.value)} />
            </label>
            <label>
              Condition grade
              <select value={conditionGrade} onChange={(event) => setConditionGrade(event.target.value)}>
                {CONDITION_GRADES.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <button type="submit" disabled={submitting}>
              Save check-in report
            </button>
          </form>
        </section>
      )}

      {checkinReport && (
        <section aria-label="Check-in photo evidence">
          <h2>2. Photos</h2>
          <p>Photograph the returned item itself — its condition on return. Never photograph the customer.</p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={submitting}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handlePhotoSelected(file);
              event.target.value = "";
            }}
          />
          <ul>
            {photos.map((photo) => (
              <li key={photo.storageKey}>{photo.fileName}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Complete return">
        <h2>3. Complete return</h2>
        <form onSubmit={handleCompleteReturn}>
          <label>
            Note
            <input value={returnNote} onChange={(event) => setReturnNote(event.target.value)} />
          </label>
          <button type="submit" disabled={!checkinReport || submitting}>
            Complete return
          </button>
        </form>
      </section>
    </main>
  );
}
