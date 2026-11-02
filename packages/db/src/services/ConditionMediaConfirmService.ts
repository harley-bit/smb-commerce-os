import { createHash } from "node:crypto";
import { assertCan, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { ConditionReportRepository } from "../repositories/ConditionReportRepository.js";
import type { ConditionMediaRepository } from "../repositories/ConditionMediaRepository.js";
import {
  ALLOWED_CONDITION_MEDIA_CONTENT_TYPES,
  ConditionReportNotFoundError,
  MAX_CONDITION_MEDIA_BYTES,
  MediaTooLargeError,
  UnsupportedMediaTypeError,
} from "./ConditionMediaUploadService.js";

export interface ConfirmConditionMediaUploadInput {
  conditionReportId: string;
  /** The `storageKey` minted by `ConditionMediaUploadService.requestUpload` — never accepted as a fresh, caller-chosen value. */
  storageKey: string;
  contentType: string;
  /** The actual uploaded bytes, hashed server-side — never trusted from a caller-declared `sha256` field. */
  bytes: Buffer;
  /** The `sha256` the client computed on-device before upload; compared against the server's own hash of `bytes`. */
  declaredSha256: string;
  capturedAt: string;
}

/** `docs/cards/D074.md` acceptance criterion — the client's declared hash doesn't match the server's hash of the actual bytes. */
export class ConditionMediaHashMismatchError extends Error {
  constructor(
    public readonly declaredSha256: string,
    public readonly actualSha256: string,
  ) {
    super(`Condition media hash mismatch: declared ${declaredSha256}, actual ${actualSha256}`);
    this.name = "ConditionMediaHashMismatchError";
  }
}

/** `docs/cards/D074.md` acceptance criterion — a `storageKey` can only ever be confirmed once. */
export class ConditionMediaStorageKeyReusedError extends Error {
  constructor(public readonly storageKey: string) {
    super(`Condition media storage key already recorded: ${storageKey}`);
    this.name = "ConditionMediaStorageKeyReusedError";
  }
}

/**
 * `docs/cards/D074.md` — the second half of the condition-media upload flow
 * `ConditionMediaUploadService` (`D073`) started: once the client has PUT its
 * bytes to the signed URL `requestUpload` minted, it calls `confirmUpload`
 * with those same bytes so the server can independently hash them and write
 * the `condition_media` row. Two tamper/integrity properties are enforced
 * here, per the card's THREAT ("tampering with dispute evidence"):
 *
 * 1. The server recomputes `sha256` from the actual bytes rather than
 *    trusting any caller-supplied hash — a mismatch against the client's
 *    own declared hash (corruption in transit, or a swapped file) is
 *    rejected outright and no row is written.
 * 2. `storageKey` can only be confirmed once — a second `confirmUpload` call
 *    against the same key (an attempt to silently swap out evidence after
 *    the fact) is rejected at the application layer, backed by a real
 *    unique index on `condition_media.storage_key` as a database-level
 *    backstop against the same race D030 already documents for its
 *    append-only audit log.
 */
export class ConditionMediaConfirmService {
  constructor(
    private readonly conditionReports: ConditionReportRepository,
    private readonly conditionMedia: ConditionMediaRepository,
  ) {}

  confirmUpload(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: ConfirmConditionMediaUploadInput,
  ): string {
    assertCan({ role: actingRole }, "bookings:manage");

    const report = this.conditionReports.findById(ctx, input.conditionReportId);
    if (!report) {
      throw new ConditionReportNotFoundError(input.conditionReportId);
    }

    if (!(ALLOWED_CONDITION_MEDIA_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
      throw new UnsupportedMediaTypeError(input.contentType);
    }

    if (
      !Number.isInteger(input.bytes.byteLength) ||
      input.bytes.byteLength <= 0 ||
      input.bytes.byteLength > MAX_CONDITION_MEDIA_BYTES
    ) {
      throw new MediaTooLargeError(input.bytes.byteLength);
    }

    const actualSha256 = createHash("sha256").update(input.bytes).digest("hex");
    if (actualSha256 !== input.declaredSha256) {
      throw new ConditionMediaHashMismatchError(input.declaredSha256, actualSha256);
    }

    if (this.conditionMedia.findByStorageKey(ctx, input.storageKey)) {
      throw new ConditionMediaStorageKeyReusedError(input.storageKey);
    }

    return this.conditionMedia.create(ctx, {
      conditionReportId: input.conditionReportId,
      storageKey: input.storageKey,
      contentType: input.contentType,
      bytes: input.bytes.byteLength,
      sha256: actualSha256,
      capturedAt: input.capturedAt,
    });
  }
}
