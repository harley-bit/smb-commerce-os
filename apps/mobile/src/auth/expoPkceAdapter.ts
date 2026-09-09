import * as Crypto from "expo-crypto";
import type { PkceAdapter } from "./pkce";

/**
 * Real, on-device `PkceAdapter` (`expo-crypto`) — no unit test, same as
 * `src/shims/nodeCrypto.ts`: `expo-crypto`/`expo-modules-core` don't load
 * under plain Node (confirmed while building this card — importing it from
 * vitest throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), only
 * inside a real Metro/RN runtime. `./pkce.ts`'s own tests cover every bit
 * of logic that can actually run outside that runtime; this file is pure
 * wiring.
 */
export const expoPkceAdapter: PkceAdapter = {
  randomBytes: (byteCount) => Crypto.getRandomBytes(byteCount),
  sha256Base64Url: async (input) => {
    const base64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
      encoding: Crypto.CryptoEncoding.BASE64,
    });
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
};
