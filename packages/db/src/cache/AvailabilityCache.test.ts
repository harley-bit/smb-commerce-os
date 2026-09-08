import { describe, expect, it } from "vitest";
import { AvailabilityCache } from "./AvailabilityCache.js";

const MERCHANT_A = "merchant-a";
const MERCHANT_B = "merchant-b";
const RESOURCE_1 = "resource-1";
const FROM = "2026-10-01T00:00:00.000Z";
const TO = "2026-10-08T00:00:00.000Z";
const FREE = [{ start: "2026-10-01T09:00:00.000Z", end: "2026-10-01T17:00:00.000Z" }];

describe("AvailabilityCache", () => {
  it("returns undefined on a miss", () => {
    const cache = new AvailabilityCache();
    expect(cache.get(MERCHANT_A, RESOURCE_1, FROM, TO)).toBeUndefined();
  });

  it("returns the cached value on a hit within the TTL", () => {
    const cache = new AvailabilityCache(30_000);
    const now = 1_000_000;
    cache.set(MERCHANT_A, RESOURCE_1, FROM, TO, FREE, now);
    expect(cache.get(MERCHANT_A, RESOURCE_1, FROM, TO, now + 10_000)).toEqual(FREE);
  });

  it("expires an entry once its TTL has elapsed", () => {
    const cache = new AvailabilityCache(30_000);
    const now = 1_000_000;
    cache.set(MERCHANT_A, RESOURCE_1, FROM, TO, FREE, now);
    expect(cache.get(MERCHANT_A, RESOURCE_1, FROM, TO, now + 30_001)).toBeUndefined();
  });

  it("keys are scoped per merchant — merchant B never sees merchant A's cached entry", () => {
    const cache = new AvailabilityCache();
    cache.set(MERCHANT_A, RESOURCE_1, FROM, TO, FREE);
    expect(cache.get(MERCHANT_B, RESOURCE_1, FROM, TO)).toBeUndefined();
  });

  it("invalidateSubject() clears every cached window for that subject, leaving others intact", () => {
    const cache = new AvailabilityCache();
    cache.set(MERCHANT_A, RESOURCE_1, FROM, TO, FREE);
    cache.set(MERCHANT_A, "resource-2", FROM, TO, FREE);
    cache.set(MERCHANT_B, RESOURCE_1, FROM, TO, FREE);

    cache.invalidateSubject(MERCHANT_A, RESOURCE_1);

    expect(cache.get(MERCHANT_A, RESOURCE_1, FROM, TO)).toBeUndefined();
    expect(cache.get(MERCHANT_A, "resource-2", FROM, TO)).toEqual(FREE);
    expect(cache.get(MERCHANT_B, RESOURCE_1, FROM, TO)).toEqual(FREE);
  });
});
