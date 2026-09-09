"use client";

import { useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Mirrors `@smb-os/domain`'s `CONDITION_GRADES` (`packages/domain/src/rentals/conditionGrade.ts`)
 * structurally rather than importing it — same reason `RentalEditor.tsx`
 * gives for its own mirrored constants: any value import from
 * `@smb-os/domain` pulls in `node:crypto` as a module-graph side effect,
 * which a "use client" browser bundle can never include.
 */
const CONDITION_GRADES = ["DAMAGED", "POOR", "FAIR", "GOOD", "EXCELLENT", "NEW"] as const;

interface ConditionReport {
  id: string;
  phase: string;
  conditionGrade: string;
}

interface UploadedPhoto {
  storageKey: string;
  fileName: string;
}

/** No `Buffer` here — this file ships to the browser, where Node's `Buffer` doesn't exist. */
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

export interface RentalCheckoutViewProps {
  merchantId: string;
  orderLineId: string;
}

/**
 * `docs/cards/D116.md` — Rental check-out flow. Two steps, gated in order:
 * (1) submit a CHECKOUT condition report (grade + notes + photos) via
 * `POST /order-lines/:orderLineId/condition-reports/checkout` and this
 * report's `/media/upload-url` + `/media/confirm` pair (`apps/api/src/routes/fulfillment.ts`);
 * (2) only once that report exists does "Complete checkout" — `POST
 * /order-lines/:orderLineId/pickup` — become available. This mirrors the
 * server-side invariant (`MissingCheckoutConditionReportError`,
 * `FulfillmentEventService`, D072) at the UI layer: the button is disabled
 * before a report is on file, so a staff member cannot even attempt the
 * skip this card's acceptance criterion forbids, and if they somehow did
 * (a stale page, a race), the server would still reject it with a 409.
 *
 * This card's security check ("photograph the asset, not the customer")
 * is answered by the guidance copy directly above the photo input below —
 * there is nothing to enforce server-side (the schema has no field that
 * could hold a person's identity in the first place), so the UI is the
 * only place this can be said.
 */
export function RentalCheckoutView({ merchantId, orderLineId }: RentalCheckoutViewProps) {
  const [inventoryUnitId, setInventoryUnitId] = useState("");
  const [conditionGrade, setConditionGrade] = useState<string>("GOOD");
  const [notes, setNotes] = useState("");
  const [report, setReport] = useState<ConditionReport | null>(null);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [pickupNote, setPickupNote] = useState("");
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreateReport(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (inventoryUnitId.trim().length === 0) {
      setError("Inventory unit is required.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/order-lines/${orderLineId}/condition-reports/checkout`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({ inventoryUnitId, conditionGrade, notes: notes.trim() || undefined }),
      });
      if (!response.ok) {
        setError("Could not record the condition report.");
        return;
      }
      setReport((await response.json()) as ConditionReport);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePhotoSelected(file: File) {
    setError(null);
    if (!report) return;
    setSubmitting(true);
    try {
      const bytes = await file.arrayBuffer();

      const grantResponse = await fetch(`${API_BASE_URL}/condition-reports/${report.id}/media/upload-url`, {
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

      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const confirmResponse = await fetch(`${API_BASE_URL}/condition-reports/${report.id}/media/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({
          storageKey: grant.storageKey,
          contentType: file.type,
          bytesBase64: arrayBufferToBase64(bytes),
          declaredSha256: arrayBufferToHex(digest),
          capturedAt: new Date().toISOString(),
        }),
      });
      if (!confirmResponse.ok) {
        setError("Could not attach that photo.");
        return;
      }
      setPhotos((current) => [...current, { storageKey: grant.storageKey, fileName: file.name }]);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteCheckout(event: React.FormEvent) {
    event.preventDefault();
    if (!report) {
      setError("A condition report is required before checkout can be completed.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/order-lines/${orderLineId}/pickup`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify({ occurredAt: new Date().toISOString(), note: pickupNote || "Checked out." }),
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? "A CHECKOUT condition report is required before this order line can be picked up."
            : "Could not complete checkout.",
        );
        return;
      }
      setCompleted(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    return (
      <main>
        <h1>Rental check-out</h1>
        <p role="status">Checked out.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Rental check-out</h1>
      {error && <p role="alert">{error}</p>}

      <section aria-label="Condition report">
        <h2>1. Condition report</h2>
        <form onSubmit={handleCreateReport}>
          <label>
            Inventory unit
            <input
              value={inventoryUnitId}
              onChange={(event) => setInventoryUnitId(event.target.value)}
              disabled={report !== null}
            />
          </label>
          <label>
            Condition grade
            <select
              value={conditionGrade}
              onChange={(event) => setConditionGrade(event.target.value)}
              disabled={report !== null}
            >
              {CONDITION_GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={report !== null} />
          </label>
          <button type="submit" disabled={report !== null || submitting}>
            Save condition report
          </button>
        </form>
        {report && <p role="status">Condition report recorded ({report.conditionGrade}).</p>}
      </section>

      <section aria-label="Photo evidence">
        <h2>2. Photos</h2>
        <p>
          Photograph the rented item itself — its condition, any existing wear or damage. Never photograph the
          customer or any other person.
        </p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          disabled={report === null || submitting}
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

      <section aria-label="Complete checkout">
        <h2>3. Complete checkout</h2>
        <form onSubmit={handleCompleteCheckout}>
          <label>
            Note
            <input value={pickupNote} onChange={(event) => setPickupNote(event.target.value)} />
          </label>
          <button type="submit" disabled={report === null || submitting}>
            Complete checkout
          </button>
        </form>
      </section>
    </main>
  );
}
