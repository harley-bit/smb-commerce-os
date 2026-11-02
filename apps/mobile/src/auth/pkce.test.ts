import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base64UrlFromBytes, createPkcePair, generateCodeChallenge, generateCodeVerifier, type PkceAdapter } from "./pkce.js";

/** A `PkceAdapter` backed by Node's own `node:crypto` — fine in this test file (only the app's own runtime code must avoid it). */
function nodeAdapter(): PkceAdapter {
  return {
    randomBytes: (byteCount) => new Uint8Array(nodeRandomBytes(byteCount)),
    sha256Base64Url: async (input) => createHash("sha256").update(input).digest("base64url"),
  };
}

describe("base64UrlFromBytes", () => {
  it("has no padding, plus, or slash characters", () => {
    const encoded = base64UrlFromBytes(new Uint8Array(nodeRandomBytes(32)));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("matches Node's own base64url encoding for arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 16, 32, 48]);
    expect(base64UrlFromBytes(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
  });
});

describe("generateCodeVerifier", () => {
  it("produces a 43-character verifier from 32 random bytes (RFC 7636's minimum recommended length)", () => {
    const verifier = generateCodeVerifier(nodeAdapter());
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is different on every call (real randomness, not a fixed value)", () => {
    const adapter = nodeAdapter();
    expect(generateCodeVerifier(adapter)).not.toBe(generateCodeVerifier(adapter));
  });
});

describe("generateCodeChallenge / createPkcePair — RFC 7636 Appendix B worked example", () => {
  const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("computes the exact S256 challenge the spec's own example expects", async () => {
    const challenge = await generateCodeChallenge(RFC_VERIFIER, nodeAdapter());
    expect(challenge).toBe(RFC_CHALLENGE);
  });

  it("createPkcePair returns a verifier whose challenge round-trips correctly", async () => {
    const adapter = nodeAdapter();
    const { verifier, challenge } = await createPkcePair(adapter);
    expect(await generateCodeChallenge(verifier, adapter)).toBe(challenge);
  });
});
