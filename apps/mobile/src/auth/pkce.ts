/**
 * OAuth 2.0 PKCE (RFC 7636) verifier/challenge generation — pure, with the
 * actual randomness and SHA-256 hashing injected via `PkceAdapter` so this
 * module never itself imports `expo-crypto` (which only loads inside a
 * real Metro/RN runtime, not plain Node/vitest — see
 * `src/shims/nodeCrypto.ts` for why). `./expoPkceAdapter.ts` wires the real
 * implementation; this file is what gets unit-tested.
 */
export interface PkceAdapter {
  /** Cryptographically random bytes — `expo-crypto`'s `getRandomBytes` on-device. */
  randomBytes(byteCount: number): Uint8Array;
  /** `BASE64URL(SHA256(input))`, no padding. */
  sha256Base64Url(input: string): Promise<string>;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** `base64url` (RFC 4648 §5), no external deps: standard base64 with `+`/`/` swapped and `=` padding stripped. */
export function base64UrlFromBytes(bytes: Uint8Array): string {
  let standard = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    standard += BASE64_CHARS[(triple >> 18) & 0x3f];
    standard += BASE64_CHARS[(triple >> 12) & 0x3f];
    standard += b1 === undefined ? "=" : BASE64_CHARS[(triple >> 6) & 0x3f];
    standard += b2 === undefined ? "=" : BASE64_CHARS[triple & 0x3f];
  }
  return standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 recommends 32+ random bytes for `code_verifier` (43 base64url chars, well within the 43-128 char range it requires). */
export function generateCodeVerifier(adapter: Pick<PkceAdapter, "randomBytes">): string {
  return base64UrlFromBytes(adapter.randomBytes(32));
}

/** RFC 7636 `S256`: `BASE64URL(SHA256(code_verifier))`. */
export function generateCodeChallenge(verifier: string, adapter: Pick<PkceAdapter, "sha256Base64Url">): Promise<string> {
  return adapter.sha256Base64Url(verifier);
}

export async function createPkcePair(adapter: PkceAdapter): Promise<PkcePair> {
  const verifier = generateCodeVerifier(adapter);
  const challenge = await generateCodeChallenge(verifier, adapter);
  return { verifier, challenge };
}
