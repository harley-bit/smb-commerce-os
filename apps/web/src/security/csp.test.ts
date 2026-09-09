import { describe, expect, it } from "vitest";
import { buildCspHeader } from "./csp";

describe("buildCspHeader", () => {
  it("never contains unsafe-inline, for any directive", () => {
    const header = buildCspHeader("test-nonce-123");
    expect(header.toLowerCase()).not.toContain("unsafe-inline");
  });

  it("never contains unsafe-eval", () => {
    const header = buildCspHeader("test-nonce-123");
    expect(header.toLowerCase()).not.toContain("unsafe-eval");
  });

  it("scripts are restricted to self plus the per-request nonce, nothing else", () => {
    const header = buildCspHeader("abc123");
    const scriptSrc = header.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("styles are restricted to self — no inline style attributes or <style> blocks permitted", () => {
    const header = buildCspHeader("abc123");
    const styleSrc = header.split(";").map((d) => d.trim()).find((d) => d.startsWith("style-src"));
    expect(styleSrc).toBe("style-src 'self'");
  });

  it("sets a restrictive default-src and blocks framing/base-uri/object-src", () => {
    const header = buildCspHeader("abc123");
    expect(header).toContain("default-src 'self'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("base-uri 'self'");
    expect(header).toContain("frame-ancestors 'none'");
  });

  it("embeds a fresh nonce per call, so two calls never produce the same header", () => {
    const first = buildCspHeader("nonce-one");
    const second = buildCspHeader("nonce-two");
    expect(first).not.toBe(second);
  });
});
