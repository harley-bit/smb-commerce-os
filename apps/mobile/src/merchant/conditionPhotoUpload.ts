const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Standard base64 (RFC 4648 §4) decode, no external deps — same reason
 * `../auth/pkce.ts`'s `base64UrlFromBytes` hand-rolls its own encoder:
 * neither `Buffer` (Node-only) nor `atob` (not guaranteed present in
 * Hermes) can be relied on here. `expo-image-picker`'s `base64: true`
 * capture option is this module's only source of bytes, so this is the
 * one decode this file needs.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const chars = [clean[i], clean[i + 1], clean[i + 2], clean[i + 3]].map((c) => (c === undefined ? -1 : BASE64_CHARS.indexOf(c)));
    const triple = ((chars[0] << 18) | (Math.max(chars[1], 0) << 12) | (Math.max(chars[2], 0) << 6) | Math.max(chars[3], 0)) >>> 0;
    bytes.push((triple >> 16) & 0xff);
    if (chars[2] !== -1) bytes.push((triple >> 8) & 0xff);
    if (chars[3] !== -1) bytes.push(triple & 0xff);
  }
  return new Uint8Array(bytes);
}

export interface CapturedConditionPhoto {
  contentType: string;
  /** Base64-encoded image bytes, straight from `expo-image-picker`'s `base64: true` capture option. */
  bytesBase64: string;
}

export interface ConditionPhotoUploadDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
  accessToken: string;
  merchantId: string;
  /** Hex-encoded SHA-256 of the given bytes — `./expoConditionPhotoCapture.ts` wires the real, on-device implementation. */
  sha256Hex: (bytes: Uint8Array) => Promise<string>;
  /** ISO 8601 capture timestamp — injected so tests control it. */
  now: () => string;
}

export type UploadConditionPhotoResult = { ok: true; storageKey: string } | { ok: false; error: string };

interface UploadGrantBody {
  storageKey: string;
}

/**
 * `docs/cards/D150.md` — mobile's condition-photo capture, calling the same
 * two-step `/condition-reports/:id/media/upload-url` + `/media/confirm`
 * pair (`apps/api/src/routes/fulfillment.ts`, D073) the web
 * `RentalCheckoutView.tsx` already uses (D116), just over `Authorization:
 * Bearer` + `x-merchant-id` headers instead of web's session cookie — the
 * same split `../account/fetchOrderHistory.ts` (D147) already made for a
 * mobile app having no cookie jar.
 *
 * This card's acceptance criterion ("photos upload with hash and
 * metadata"): `declaredSha256` is computed here from the exact bytes sent
 * as `bytesBase64`, and the server independently re-hashes those bytes and
 * rejects the confirm on any mismatch (`ConditionMediaHashMismatchError`) —
 * so a tampered upload can't be confirmed under a hash that doesn't match
 * what was actually stored. `capturedAt` is the metadata half.
 */
export async function uploadConditionPhoto(
  deps: ConditionPhotoUploadDeps,
  conditionReportId: string,
  photo: CapturedConditionPhoto,
): Promise<UploadConditionPhotoResult> {
  const bytes = base64ToBytes(photo.bytesBase64);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${deps.accessToken}`,
    "x-merchant-id": deps.merchantId,
  };

  const grantResponse = await deps.fetchFn(`${deps.baseUrl}/condition-reports/${conditionReportId}/media/upload-url`, {
    method: "POST",
    headers,
    body: JSON.stringify({ contentType: photo.contentType, bytes: bytes.length }),
  });
  if (!grantResponse.ok) {
    return { ok: false, error: "Could not attach that photo." };
  }
  const grant = (await grantResponse.json()) as UploadGrantBody;

  const declaredSha256 = await deps.sha256Hex(bytes);
  const confirmResponse = await deps.fetchFn(`${deps.baseUrl}/condition-reports/${conditionReportId}/media/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      storageKey: grant.storageKey,
      contentType: photo.contentType,
      bytesBase64: photo.bytesBase64,
      declaredSha256,
      capturedAt: deps.now(),
    }),
  });
  if (!confirmResponse.ok) {
    return { ok: false, error: "Could not attach that photo." };
  }

  return { ok: true, storageKey: grant.storageKey };
}
