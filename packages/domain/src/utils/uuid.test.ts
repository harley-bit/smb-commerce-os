import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { generateUuidV7, isUuidV7 } from "./uuid.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateUuidV7", () => {
  it("produces a string matching the RFC 9562 UUIDv7 shape", () => {
    const id = generateUuidV7();
    expect(id).toMatch(UUID_V7_RE);
  });

  it("is recognized by isUuidV7", () => {
    expect(isUuidV7(generateUuidV7())).toBe(true);
  });

  it("rejects a UUIDv4 string", () => {
    expect(isUuidV7("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(false);
  });

  it("property: every generated id has the version and variant bits set", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const id = generateUuidV7();
        expect(id).toMatch(UUID_V7_RE);
      }),
      { numRuns: 200 },
    );
  });

  it("property: the embedded millisecond timestamp is non-decreasing across calls", () => {
    const timestamps: bigint[] = [];
    for (let i = 0; i < 200; i += 1) {
      const id = generateUuidV7();
      const hex = id.replace(/-/g, "").slice(0, 12);
      timestamps.push(BigInt(`0x${hex}`));
    }
    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i]! >= timestamps[i - 1]!).toBe(true);
    }
  });

  it("generates unique ids across many calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      ids.add(generateUuidV7());
    }
    expect(ids.size).toBe(1000);
  });
});
