import { describe, expect, it } from "vitest";
import { createServiceBookingInputSchema } from "./booking.js";

const validInput = {
  resourceId: "01977e6a-0000-7000-8000-000000000000",
  startsAt: "2026-10-01T09:00:00.000Z",
  endsAt: "2026-10-01T10:00:00.000Z",
  quantity: 1,
  idempotencyKey: "idem-1",
};

describe("createServiceBookingInputSchema", () => {
  it("accepts a well-formed booking input", () => {
    expect(createServiceBookingInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("rejects a missing idempotencyKey", () => {
    const rest: Record<string, unknown> = { ...validInput };
    delete rest.idempotencyKey;
    expect(() => createServiceBookingInputSchema.parse(rest)).toThrow();
  });

  it("rejects an empty idempotencyKey (D059 security check)", () => {
    expect(() => createServiceBookingInputSchema.parse({ ...validInput, idempotencyKey: "" })).toThrow();
  });

  it("rejects a non-positive quantity", () => {
    expect(() => createServiceBookingInputSchema.parse({ ...validInput, quantity: 0 })).toThrow();
  });
});
