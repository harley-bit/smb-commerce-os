"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import type { InventoryUnitWithRentalStatusRecord } from "@smb-os/contracts";
import { Button, TextField } from "../../../components";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Mirrors `@smb-os/contracts`'s `createInventoryUnitInputSchema` structural
 * rules without importing the real schema — same `node:crypto`-via-
 * `@smb-os/domain` bundling reason `ProductEditor.tsx`/`VariantTable.tsx`
 * document (importing any *value* from `@smb-os/contracts`'s barrel pulls
 * in `variant.ts`'s `Money.of`). This card's security check —
 * "acquisition data captured now, impossible to backfill" — is enforced
 * server-side by the real schema requiring both fields at creation; this
 * mirror exists only to reject an incomplete add-unit form before any
 * fetch fires.
 */
const addUnitSchema = z.object({
  unitCode: z.string().min(1),
  trackingMode: z.enum(["SERIALIZED", "FUNGIBLE"]),
  locationId: z.string().min(1),
  acquisitionCostMinor: z.number().int().nonnegative(),
  acquiredAt: z.string().min(1),
  expectedLifeMonths: z.number().int().positive().optional(),
  conditionGrade: z.string().min(1).optional(),
});

const editUnitSchema = z.object({
  unitCode: z.string().min(1),
  expectedLifeMonths: z.number().int().positive().optional(),
  conditionGrade: z.string().min(1).optional(),
});

interface RowDraft {
  unitCode: string;
  expectedLifeMonths: string;
  conditionGrade: string;
}

function draftFromUnit(unit: InventoryUnitWithRentalStatusRecord): RowDraft {
  return {
    unitCode: unit.unitCode,
    expectedLifeMonths: unit.expectedLifeMonths === null ? "" : String(unit.expectedLifeMonths),
    conditionGrade: unit.conditionGrade ?? "",
  };
}

interface NewUnitDraft {
  unitCode: string;
  trackingMode: "SERIALIZED" | "FUNGIBLE";
  locationId: string;
  acquisitionCostMinor: string;
  acquiredAt: string;
}

const emptyNewUnit: NewUnitDraft = {
  unitCode: "",
  trackingMode: "SERIALIZED",
  locationId: "",
  acquisitionCostMinor: "",
  acquiredAt: "",
};

export interface InventoryUnitsViewProps {
  merchantId: string;
  listingId: string;
  variantId: string;
}

/**
 * `docs/cards/D110.md` — Inventory unit management. Lists, adds, edits, and
 * retires the individual inventory units behind one variant, through the
 * new `apps/api/src/routes/inventoryUnits.ts` routes. This card's
 * acceptance criterion ("units tracked individually for rentals") is
 * proven by every unit rendering its own row, independently editable and
 * retireable. This card's security check — "acquisition data captured now,
 * impossible to backfill" — shapes the UI directly: `acquisitionCostMinor`/
 * `acquiredAt` are only ever entered on the "Add unit" form, never exposed
 * on an existing row's edit controls, since the server's own
 * `updateInventoryUnitInputSchema` rejects them outright.
 */
export function InventoryUnitsView({ merchantId, listingId, variantId }: InventoryUnitsViewProps) {
  const [units, setUnits] = useState<InventoryUnitWithRentalStatusRecord[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [newUnit, setNewUnit] = useState<NewUnitDraft>(emptyNewUnit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [retiringId, setRetiringId] = useState<string | null>(null);

  async function loadUnits() {
    const response = await fetch(`${API_BASE_URL}/listings/${listingId}/variants/${variantId}/units`, {
      credentials: "include",
      headers: { "x-merchant-id": merchantId },
    });
    if (!response.ok) {
      setError("Could not load inventory units.");
      return;
    }
    const loaded = (await response.json()) as InventoryUnitWithRentalStatusRecord[];
    setUnits(loaded);
    setDrafts(Object.fromEntries(loaded.map((unit) => [unit.id, draftFromUnit(unit)])));
  }

  useEffect(() => {
    void loadUnits();
  }, [merchantId, listingId, variantId]);

  function updateDraft(unitId: string, patch: Partial<RowDraft>) {
    setDrafts((current) => {
      const existing = current[unitId];
      if (!existing) return current;
      return { ...current, [unitId]: { ...existing, ...patch } };
    });
  }

  function dirtyUnitIds(): string[] {
    if (!units) return [];
    return units
      .filter((unit) => {
        const draft = drafts[unit.id];
        if (!draft) return false;
        const original = draftFromUnit(unit);
        return (
          draft.unitCode !== original.unitCode ||
          draft.expectedLifeMonths !== original.expectedLifeMonths ||
          draft.conditionGrade !== original.conditionGrade
        );
      })
      .map((unit) => unit.id);
  }

  async function handleAddUnit() {
    setError(null);
    if (newUnit.acquisitionCostMinor.trim() === "") {
      setError("Acquisition cost is required — it cannot be added later.");
      return;
    }
    const parsed = addUnitSchema.safeParse({
      unitCode: newUnit.unitCode,
      trackingMode: newUnit.trackingMode,
      locationId: newUnit.locationId,
      acquisitionCostMinor: Number(newUnit.acquisitionCostMinor),
      acquiredAt: newUnit.acquiredAt,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid unit details.");
      return;
    }

    setAdding(true);
    try {
      const response = await fetch(`${API_BASE_URL}/listings/${listingId}/variants/${variantId}/units`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-merchant-id": merchantId },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
        setError(body.detail ?? body.title ?? "Could not add unit.");
        return;
      }
      setNewUnit(emptyNewUnit);
      await loadUnits();
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveAll() {
    setError(null);
    const dirtyIds = dirtyUnitIds();
    if (dirtyIds.length === 0) {
      return;
    }

    const parsedByUnitId = new Map<string, z.infer<typeof editUnitSchema>>();
    for (const unitId of dirtyIds) {
      const draft = drafts[unitId];
      if (!draft) continue;
      const parsed = editUnitSchema.safeParse({
        unitCode: draft.unitCode,
        expectedLifeMonths: draft.expectedLifeMonths === "" ? undefined : Number(draft.expectedLifeMonths),
        conditionGrade: draft.conditionGrade === "" ? undefined : draft.conditionGrade,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Invalid unit details.");
        return;
      }
      parsedByUnitId.set(unitId, parsed.data);
    }

    setSaving(true);
    try {
      for (const [unitId, patch] of parsedByUnitId) {
        const response = await fetch(
          `${API_BASE_URL}/listings/${listingId}/variants/${variantId}/units/${unitId}`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/json", "x-merchant-id": merchantId },
            body: JSON.stringify(patch),
          },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
          setError(body.detail ?? body.title ?? "Could not save a unit.");
          return;
        }
      }
      await loadUnits();
    } finally {
      setSaving(false);
    }
  }

  async function handleRetire(unitId: string) {
    setError(null);
    setRetiringId(unitId);
    try {
      const response = await fetch(
        `${API_BASE_URL}/listings/${listingId}/variants/${variantId}/units/${unitId}/retire`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", "x-merchant-id": merchantId },
          body: JSON.stringify({ note: "Retired from dashboard" }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
        setError(body.detail ?? body.title ?? "Could not retire unit.");
        return;
      }
      await loadUnits();
    } finally {
      setRetiringId(null);
    }
  }

  if (error === null && units === null) {
    return (
      <main>
        <h1>Inventory units</h1>
        <p>Loading…</p>
      </main>
    );
  }

  const hasDirtyRows = dirtyUnitIds().length > 0;

  return (
    <main>
      <h1>Inventory units</h1>
      {error ? <p role="alert">{error}</p> : null}

      {units && units.length === 0 ? (
        <p>No units tracked for this variant yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Unit code</th>
              <th>Status</th>
              <th>Rental status</th>
              <th>Expected life (months)</th>
              <th>Condition grade</th>
              <th>Acquisition cost (minor units)</th>
              <th>Acquired at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {units?.map((unit) => {
              const draft = drafts[unit.id] ?? draftFromUnit(unit);
              const outOnRental = unit.rentalStatus === "OUT_ON_RENTAL";
              const retireable = unit.status !== "SOLD" && unit.status !== "RETIRED" && !outOnRental;
              return (
                <tr key={unit.id}>
                  <td>
                    <TextField
                      label={`Unit code for ${unit.id}`}
                      value={draft.unitCode}
                      onChange={(event) => updateDraft(unit.id, { unitCode: event.target.value })}
                    />
                  </td>
                  <td>{unit.status}</td>
                  <td>
                    {outOnRental ? (
                      <span>
                        Out on rental — due back {unit.returnDueAt} — unavailable for sale
                      </span>
                    ) : (
                      <span>Available</span>
                    )}
                  </td>
                  <td>
                    <TextField
                      label={`Expected life for ${unit.id}`}
                      value={draft.expectedLifeMonths}
                      onChange={(event) => updateDraft(unit.id, { expectedLifeMonths: event.target.value })}
                    />
                  </td>
                  <td>
                    <TextField
                      label={`Condition grade for ${unit.id}`}
                      value={draft.conditionGrade}
                      onChange={(event) => updateDraft(unit.id, { conditionGrade: event.target.value })}
                    />
                  </td>
                  <td>{unit.acquisitionCostMinor}</td>
                  <td>{unit.acquiredAt}</td>
                  <td>
                    <Button
                      onClick={() => void handleRetire(unit.id)}
                      disabled={!retireable || retiringId === unit.id}
                    >
                      Retire
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Button onClick={() => void handleSaveAll()} disabled={saving || !hasDirtyRows}>
        Save changes
      </Button>

      <h2>Add unit</h2>
      <TextField
        label="New unit code"
        value={newUnit.unitCode}
        onChange={(event) => setNewUnit((current) => ({ ...current, unitCode: event.target.value }))}
      />
      <label>
        Tracking mode
        <select
          value={newUnit.trackingMode}
          onChange={(event) =>
            setNewUnit((current) => ({
              ...current,
              trackingMode: event.target.value as "SERIALIZED" | "FUNGIBLE",
            }))
          }
        >
          <option value="SERIALIZED">Serialized</option>
          <option value="FUNGIBLE">Fungible</option>
        </select>
      </label>
      <TextField
        label="Location id"
        value={newUnit.locationId}
        onChange={(event) => setNewUnit((current) => ({ ...current, locationId: event.target.value }))}
      />
      <TextField
        label="Acquisition cost (minor units)"
        value={newUnit.acquisitionCostMinor}
        onChange={(event) =>
          setNewUnit((current) => ({ ...current, acquisitionCostMinor: event.target.value }))
        }
      />
      <TextField
        label="Acquired at"
        value={newUnit.acquiredAt}
        onChange={(event) => setNewUnit((current) => ({ ...current, acquiredAt: event.target.value }))}
      />
      <Button onClick={() => void handleAddUnit()} disabled={adding}>
        Add unit
      </Button>
    </main>
  );
}
