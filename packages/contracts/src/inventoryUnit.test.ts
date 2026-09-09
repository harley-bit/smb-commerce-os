import { describe, expect, it } from "vitest";
import {
  createInventoryUnitInputSchema,
  inventoryUnitSchema,
  updateInventoryUnitInputSchema,
} from "./inventoryUnit.js";

const validUnit = {
  id: "01977e6a-0000-7000-8000-000000000000",
  merchantId: "01977e6a-0000-7000-8000-000000000001",
  variantId: "01977e6a-0000-7000-8000-000000000002",
  locationId: "01977e6a-0000-7000-8000-000000000003",
  unitCode: "SN-001",
  trackingMode: "SERIALIZED" as const,
  status: "AVAILABLE" as const,
  acquisitionCostMinor: 500000,
  acquiredAt: "2026-09-08T00:00:00.000Z",
  expectedLifeMonths: 36,
  conditionGrade: "A",
  retiredAt: null,
};

describe("inventoryUnitSchema", () => {
  it("accepts a well-formed unit row", () => {
    expect(inventoryUnitSchema.parse(validUnit)).toEqual(validUnit);
  });

  it("rejects an unknown status", () => {
    expect(() => inventoryUnitSchema.parse({ ...validUnit, status: "BROKEN" })).toThrow();
  });
});

describe("createInventoryUnitInputSchema", () => {
  const validInput = {
    variantId: validUnit.variantId,
    locationId: validUnit.locationId,
    unitCode: "SN-002",
    trackingMode: "SERIALIZED" as const,
    acquisitionCostMinor: 500000,
    acquiredAt: "2026-09-08T00:00:00.000Z",
  };

  it("accepts a valid create payload", () => {
    expect(createInventoryUnitInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("this card's security check — rejects a create payload missing acquisitionCostMinor", () => {
    const { acquisitionCostMinor, ...withoutCost } = validInput;
    void acquisitionCostMinor;
    expect(() => createInventoryUnitInputSchema.parse(withoutCost)).toThrow();
  });

  it("this card's security check — rejects a create payload missing acquiredAt", () => {
    const { acquiredAt, ...withoutDate } = validInput;
    void acquiredAt;
    expect(() => createInventoryUnitInputSchema.parse(withoutDate)).toThrow();
  });

  it("rejects a negative acquisition cost", () => {
    expect(() => createInventoryUnitInputSchema.parse({ ...validInput, acquisitionCostMinor: -1 })).toThrow();
  });
});

describe("updateInventoryUnitInputSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateInventoryUnitInputSchema.parse({})).toEqual({});
  });

  it("accepts unitCode/locationId/expectedLifeMonths/conditionGrade", () => {
    const input = { unitCode: "SN-003", conditionGrade: "B" };
    expect(updateInventoryUnitInputSchema.parse(input)).toEqual(input);
  });

  it("this card's security check — rejects acquisitionCostMinor in an update payload, impossible to backfill", () => {
    expect(() => updateInventoryUnitInputSchema.parse({ acquisitionCostMinor: 100 })).toThrow();
  });

  it("this card's security check — rejects acquiredAt in an update payload", () => {
    expect(() => updateInventoryUnitInputSchema.parse({ acquiredAt: "2026-09-09T00:00:00.000Z" })).toThrow();
  });

  it("rejects a status key — status changes go through transitionStatus, not this schema", () => {
    expect(() => updateInventoryUnitInputSchema.parse({ status: "SOLD" })).toThrow();
  });
});
