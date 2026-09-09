import * as Crypto from "expo-crypto";
import type { CartLineGenerators } from "./cartStore";

/**
 * Real, on-device `CartLineGenerators` — no unit test, same posture as
 * `../auth/expoPkceAdapter.ts`: `expo-crypto` doesn't load under plain Node,
 * only inside a real Metro/RN runtime, so this file is pure wiring and
 * `./cartStore.test.ts` covers every bit of logic that can actually run
 * outside it (fixed-string generators injected instead).
 */
export const expoCartLineGenerators: CartLineGenerators = {
  generateLineId: () => Crypto.randomUUID(),
  generateIdempotencyKey: () => Crypto.randomUUID(),
};
