import { randomBytes } from "node:crypto";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * RFC 9562 UUIDv7: a 48-bit big-endian millisecond Unix timestamp followed
 * by random bits (with the version/variant bits fixed). Prefixing with time
 * keeps generated ids roughly sortable/index-friendly, unlike UUIDv4.
 */
export function generateUuidV7(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());

  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_RE.test(value);
}
