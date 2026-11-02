import { describe, expect, it } from "vitest";
import { HmacMediaUploadProvider } from "./HmacMediaUploadProvider.js";

describe("HmacMediaUploadProvider", () => {
  it("returns an upload URL under the configured private base, carrying the given storage key", async () => {
    const provider = new HmacMediaUploadProvider({
      baseUrl: "https://media.internal.example/upload",
      secret: "test-secret",
    });

    const result = await provider.createUploadUrl("condition-media/m1/r1/k1", "image/jpeg", 1000);

    expect(result.storageKey).toEqual("condition-media/m1/r1/k1");
    expect(result.uploadUrl.startsWith("https://media.internal.example/upload/")).toBe(true);
    expect(result.uploadUrl).toContain("signature=");
  });

  it("sets expiresAt in the future, within the configured TTL", async () => {
    const provider = new HmacMediaUploadProvider({
      baseUrl: "https://media.internal.example/upload",
      secret: "test-secret",
      ttlSeconds: 60,
    });

    const before = Date.now();
    const result = await provider.createUploadUrl("condition-media/m1/r1/k1", "image/png", 500);
    const expiresAtMs = new Date(result.expiresAt).getTime();

    expect(expiresAtMs).toBeGreaterThan(before);
    expect(expiresAtMs).toBeLessThanOrEqual(before + 60_000 + 5);
  });

  it("produces a different signature for a different secret — the URL cannot be forged without it", async () => {
    const providerA = new HmacMediaUploadProvider({
      baseUrl: "https://media.internal.example/upload",
      secret: "secret-a",
    });
    const providerB = new HmacMediaUploadProvider({
      baseUrl: "https://media.internal.example/upload",
      secret: "secret-b",
    });

    const resultA = await providerA.createUploadUrl("condition-media/m1/r1/k1", "image/jpeg", 1000);
    const resultB = await providerB.createUploadUrl("condition-media/m1/r1/k1", "image/jpeg", 1000);

    const signatureOf = (url: string): string => new URL(url).searchParams.get("signature")!;
    expect(signatureOf(resultA.uploadUrl)).not.toEqual(signatureOf(resultB.uploadUrl));
  });

  it("produces a different signature for a tampered maxBytes — a client cannot widen its own size limit", async () => {
    const provider = new HmacMediaUploadProvider({
      baseUrl: "https://media.internal.example/upload",
      secret: "test-secret",
    });

    const result = await provider.createUploadUrl("condition-media/m1/r1/k1", "image/jpeg", 1000);
    const url = new URL(result.uploadUrl);
    const originalSignature = url.searchParams.get("signature");
    url.searchParams.set("maxBytes", "999999999");

    expect(url.searchParams.get("signature")).toEqual(originalSignature);
    // the signature no longer matches the tampered payload, so a verifier
    // recomputing it from the (now-mismatched) params would reject the URL
    const tamperedResult = await provider.createUploadUrl("condition-media/m1/r1/k1", "image/jpeg", 999999999);
    expect(new URL(tamperedResult.uploadUrl).searchParams.get("signature")).not.toEqual(originalSignature);
  });
});
