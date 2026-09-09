import { publicMerchantProfileSchema, type PublicMerchantProfile } from "@smb-os/contracts";

export type ParseMerchantProfileResult =
  | { ok: true; profile: PublicMerchantProfile }
  | { ok: false; error: string };

/**
 * The mobile app shell's only piece of validation logic: parsing the same
 * `GET /v1/m/{merchantSlug}` payload the web storefront (`apps/web`) reads,
 * against the same `publicMerchantProfileSchema` from `@smb-os/contracts` —
 * one shared Zod definition, not a second hand-written mobile copy.
 */
export function parseMerchantProfile(payload: unknown): ParseMerchantProfileResult {
  const result = publicMerchantProfileSchema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, profile: result.data };
}
