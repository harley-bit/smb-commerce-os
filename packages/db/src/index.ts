import { workspaceGraphMarker } from "@smb-os/domain";

export function dbPackageMarker(): string {
  return `@smb-os/db -> ${workspaceGraphMarker()}`;
}
