import { assertCan, generateUuidV7, type MediaUploadProvider, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { ConditionReportRepository } from "../repositories/ConditionReportRepository.js";

/** `docs/design/07`'s condition-media threat table — the allowlist an upload's declared content type must fall in. */
export const ALLOWED_CONDITION_MEDIA_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** 15 MB — generous for a phone photo, tight enough to bound storage-exhaustion abuse per `docs/design/07`'s threat table. */
export const MAX_CONDITION_MEDIA_BYTES = 15_000_000;

export interface RequestConditionMediaUploadInput {
  conditionReportId: string;
  contentType: string;
  bytes: number;
}

export interface ConditionMediaUploadGrant {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

/** Thrown when `conditionReportId` doesn't resolve to a report owned by the caller's merchant. */
export class ConditionReportNotFoundError extends Error {
  constructor(public readonly conditionReportId: string) {
    super(`Condition report not found: ${conditionReportId}`);
    this.name = "ConditionReportNotFoundError";
  }
}

/** `docs/cards/D073.md` acceptance criterion. */
export class UnsupportedMediaTypeError extends Error {
  constructor(public readonly contentType: string) {
    super(`Unsupported content type for condition media: ${contentType}`);
    this.name = "UnsupportedMediaTypeError";
  }
}

/** `docs/cards/D073.md` acceptance criterion — also covers a non-positive/non-integer declared size. */
export class MediaTooLargeError extends Error {
  constructor(public readonly bytes: number) {
    super(`Condition media size ${bytes} bytes is invalid or exceeds the ${MAX_CONDITION_MEDIA_BYTES}-byte limit`);
    this.name = "MediaTooLargeError";
  }
}

/**
 * `docs/cards/D073.md` — issues a signed upload grant for one piece of
 * condition media, gated on content-type and declared-size limits before
 * any signature is minted. `storageKey` is generated here, never accepted
 * from the caller, and is namespaced by merchant and condition report
 * (`condition-media/{merchantId}/{conditionReportId}/{uuidv7}`) plus a
 * fresh UUIDv7 suffix — the "randomized keys" half of `docs/design/07`'s
 * security check; "private bucket, no public access" is the
 * `MediaUploadProvider` implementation's responsibility (`../media/HmacMediaUploadProvider.ts`
 * today). This card only mints the upload grant — it does not write a
 * `condition_media` row; that happens once the upload is confirmed
 * (`docs/cards/D074.md`, which also verifies the uploaded bytes' `sha256`).
 */
export class ConditionMediaUploadService {
  constructor(
    private readonly conditionReports: ConditionReportRepository,
    private readonly uploadProvider: MediaUploadProvider,
  ) {}

  async requestUpload(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: RequestConditionMediaUploadInput,
  ): Promise<ConditionMediaUploadGrant> {
    assertCan({ role: actingRole }, "bookings:manage");

    const report = this.conditionReports.findById(ctx, input.conditionReportId);
    if (!report) {
      throw new ConditionReportNotFoundError(input.conditionReportId);
    }

    if (!(ALLOWED_CONDITION_MEDIA_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
      throw new UnsupportedMediaTypeError(input.contentType);
    }

    if (!Number.isInteger(input.bytes) || input.bytes <= 0 || input.bytes > MAX_CONDITION_MEDIA_BYTES) {
      throw new MediaTooLargeError(input.bytes);
    }

    const storageKey = `condition-media/${ctx.merchantId}/${report.id}/${generateUuidV7()}`;
    const signed = await this.uploadProvider.createUploadUrl(storageKey, input.contentType, input.bytes);

    return { uploadUrl: signed.uploadUrl, storageKey: signed.storageKey, expiresAt: signed.expiresAt };
  }
}
