import { describe, expect, it } from "vitest";
import { generateUuidV7 } from "../utils/uuid.js";
import { createTenantContext, type TenantContext } from "./TenantContext.js";

describe("TenantContext", () => {
  it("constructs from a valid UUIDv7 merchant id", () => {
    const merchantId = generateUuidV7();
    const ctx = createTenantContext(merchantId);
    expect(ctx.merchantId).toBe(merchantId);
  });

  it("rejects a non-UUIDv7 merchant id", () => {
    expect(() => createTenantContext("not-a-uuid")).toThrow();
    expect(() => createTenantContext("")).toThrow();
  });

  it("rejects a UUIDv4 masquerading as a merchant id (wrong version nibble)", () => {
    expect(() => createTenantContext("3f6f9a10-0c2a-4b7a-8b1e-2f6a9c7d5e11")).toThrow();
  });

  it("is a plain, structurally-typed value — no I/O, no methods", () => {
    const merchantId = generateUuidV7();
    const ctx: TenantContext = { merchantId };
    expect(ctx.merchantId).toBe(merchantId);
  });
});
