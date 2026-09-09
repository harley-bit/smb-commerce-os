import { getRandomBytes } from "expo-crypto";

/**
 * Metro (unlike Node/webpack) has no `node:crypto`, and has no real
 * tree-shaking across a package boundary — importing anything from
 * `@smb-os/contracts` pulls in the whole `@smb-os/domain` module graph,
 * including `utils/uuid.ts`'s `randomBytes` import, even though this app
 * shell never calls `generateUuidV7` itself. `metro.config.js` redirects
 * `node:crypto` here so that graph still resolves on-device.
 *
 * This only needs to satisfy module resolution, not full `node:crypto`
 * semantics: nothing in the mobile app shell calls `generateUuidV7` (ids
 * are server-issued), so the `Buffer`-only `.toString("hex")` call inside
 * it is dead code here, not something this shim needs to replicate.
 */
export function randomBytes(byteCount: number): Uint8Array {
  return getRandomBytes(byteCount);
}
