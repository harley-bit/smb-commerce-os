import { createHmac } from "node:crypto";
import type { MediaUploadProvider, SignedMediaUpload } from "@smb-os/domain";

export interface HmacMediaUploadProviderConfig {
  /** Private bucket's upload endpoint — never a publicly listable/browsable URL. */
  baseUrl: string;
  secret: string;
  /** Default 900s (15 minutes) — long enough for one upload, short enough to limit a leaked URL's blast radius. */
  ttlSeconds?: number;
}

/**
 * `docs/cards/D073.md` — no cloud object-storage account has been
 * provisioned for this project yet (the same "native now, real provider
 * later" situation D010/ADR-002 already established for authentication).
 * This implementation upholds the same security properties
 * a real presigned S3/R2 URL would (short-lived expiry, a signature the
 * client cannot forge or widen) using only Node's built-in `crypto`, behind
 * the `MediaUploadProvider` seam — swapping in a real cloud-backed
 * implementation later touches only composition, not `ConditionMediaUploadService`.
 */
export class HmacMediaUploadProvider implements MediaUploadProvider {
  constructor(private readonly config: HmacMediaUploadProviderConfig) {}

  async createUploadUrl(
    storageKey: string,
    contentType: string,
    maxBytes: number,
  ): Promise<SignedMediaUpload> {
    const ttlSeconds = this.config.ttlSeconds ?? 900;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const signature = this.sign(storageKey, contentType, maxBytes, expiresAt);

    const url = new URL(`${this.config.baseUrl}/${encodeURIComponent(storageKey)}`);
    url.searchParams.set("contentType", contentType);
    url.searchParams.set("maxBytes", String(maxBytes));
    url.searchParams.set("expires", expiresAt);
    url.searchParams.set("signature", signature);

    return { uploadUrl: url.toString(), storageKey, expiresAt };
  }

  private sign(storageKey: string, contentType: string, maxBytes: number, expiresAt: string): string {
    const payload = [storageKey, contentType, String(maxBytes), expiresAt].join(":");
    return createHmac("sha256", this.config.secret).update(payload).digest("hex");
  }
}
