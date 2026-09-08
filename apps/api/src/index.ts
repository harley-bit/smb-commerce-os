import { dbPackageMarker } from "@smb-os/db";

export function apiAppMarker(): string {
  return `@smb-os/api -> ${dbPackageMarker()}`;
}
