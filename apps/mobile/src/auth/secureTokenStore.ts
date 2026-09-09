/**
 * `docs/cards/D138.md`'s security check: mobile access/refresh tokens are
 * never persisted to the plain, unencrypted key-value cache React Native
 * apps commonly reach for (sandboxed only by app id — not a secure store)
 * — only to the platform's real secure storage (iOS Keychain / Android
 * Keystore, via `expo-secure-store`, which backs both automatically
 * behind one identical JS API). `./noAsyncStorage.test.ts` statically
 * enforces this by scanning every source file under `src/` for that
 * unencrypted cache's package name.
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SecureTokenStorage {
  save(pair: TokenPair): Promise<void>;
  load(): Promise<TokenPair | null>;
  clear(): Promise<void>;
}
