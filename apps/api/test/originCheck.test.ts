import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../src/auth/originCheck";

describe("isAllowedOrigin", () => {
  it("allows when there is no Origin or Referer header at all", () => {
    expect(isAllowedOrigin(undefined, undefined, ["https://app.example.com"])).toBe(true);
  });

  it("falls back to deriving the origin from Referer when Origin is absent", () => {
    expect(
      isAllowedOrigin(undefined, "https://app.example.com/some/path", ["https://app.example.com"]),
    ).toBe(true);
    expect(
      isAllowedOrigin(undefined, "https://evil.example.com/some/path", ["https://app.example.com"]),
    ).toBe(false);
  });

  it("prefers Origin over Referer when both are present", () => {
    expect(
      isAllowedOrigin("https://app.example.com", "https://evil.example.com/", ["https://app.example.com"]),
    ).toBe(true);
  });
});
