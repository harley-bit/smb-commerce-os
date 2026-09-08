import { contractsPackageMarker } from "@smb-os/contracts";

export function webAppMarker(): string {
  return `@smb-os/web -> ${contractsPackageMarker()}`;
}
