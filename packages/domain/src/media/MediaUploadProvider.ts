/**
 * A signed, time-limited upload grant for one object. `storageKey` is the
 * randomized key the object will be stored under; `uploadUrl` is the only
 * thing the caller needs to actually PUT the bytes.
 */
export interface SignedMediaUpload {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

/**
 * `docs/cards/D073.md` — object-storage seam, same shape as `AuthProvider`
 * (`../auth/AuthProvider.ts`): callers depend on this interface only, so a
 * future real cloud-storage-backed implementation swaps in behind it
 * without touching `ConditionMediaUploadService` or any other consumer.
 * `docs/design/07`'s security check for condition media ("private bucket,
 * randomized keys, no public access") is a property every implementation
 * of this interface must uphold, not something a caller can opt out of.
 */
export interface MediaUploadProvider {
  createUploadUrl(storageKey: string, contentType: string, maxBytes: number): Promise<SignedMediaUpload>;
}
