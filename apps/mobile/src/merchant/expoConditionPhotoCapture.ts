import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import type { CapturedConditionPhoto } from "./conditionPhotoUpload.js";

export type CapturePhotoResult =
  | { status: "captured"; photo: CapturedConditionPhoto }
  | { status: "permission-denied" }
  | { status: "cancelled" };

/**
 * Real, on-device camera capture (`expo-image-picker`) — no unit test,
 * same reason as `../auth/expoPkceAdapter.ts`: native Expo modules don't
 * load under plain Node/vitest, only inside a real Metro/RN runtime.
 * `./conditionPhotoUpload.ts`'s own tests cover every bit of logic that
 * can actually run outside that runtime; this file is pure wiring.
 *
 * This card's security check ("camera permission requested with a clear
 * purpose string"): the purpose string itself lives in `app.json`'s
 * `expo-image-picker` plugin config (`cameraPermission`), which is what
 * iOS/Android actually show the user in the system permission prompt this
 * call triggers — there is no separate string to keep in sync here.
 * Permission is requested fresh on every capture attempt rather than
 * assumed from a prior grant, so a mid-session revocation (device
 * settings) is caught before `launchCameraAsync` is ever called.
 */
export async function captureConditionPhoto(): Promise<CapturePhotoResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { status: "permission-denied" };
  }

  const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8 });
  if (result.canceled || result.assets.length === 0) {
    return { status: "cancelled" };
  }

  const asset = result.assets[0];
  if (!asset.base64) {
    return { status: "cancelled" };
  }

  return {
    status: "captured",
    photo: { contentType: asset.mimeType ?? "image/jpeg", bytesBase64: asset.base64 },
  };
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** `../merchant/conditionPhotoUpload.ts`'s `sha256Hex` dependency, wired to `expo-crypto`'s raw-byte digest. */
export async function expoSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as BufferSource);
  return bytesToHex(digest);
}
