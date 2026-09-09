import * as SecureStore from "expo-secure-store";
import type { SecureTokenStorage, TokenPair } from "./secureTokenStore";

const ACCESS_TOKEN_KEY = "smb-os.mobileAccessToken";
const REFRESH_TOKEN_KEY = "smb-os.mobileRefreshToken";

/**
 * Real, on-device `SecureTokenStorage` — Keychain on iOS, Keystore on
 * Android, both behind `expo-secure-store`'s one JS API (no platform
 * branching needed here; the native module handles it). No unit test —
 * same as `./expoPkceAdapter.ts`, `expo-secure-store` doesn't load under
 * plain Node/vitest. `./authClient.ts`'s tests exercise every call site
 * against an in-memory `SecureTokenStorage` fake satisfying this same
 * interface.
 */
export class ExpoSecureTokenStore implements SecureTokenStorage {
  async save(pair: TokenPair): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, pair.accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, pair.refreshToken),
    ]);
  }

  async load(): Promise<TokenPair | null> {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    ]);
    return accessToken && refreshToken ? { accessToken, refreshToken } : null;
  }

  async clear(): Promise<void> {
    await Promise.all([SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY), SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)]);
  }
}
