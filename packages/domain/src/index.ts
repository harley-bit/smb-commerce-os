export * from "./auth/AuthProvider.js";
export * from "./utils/uuid.js";
export * from "./utils/money.js";
export * from "./utils/time.js";

export function workspaceGraphMarker(): string {
  return "@smb-os/domain";
}

export function isNonEmptyLabel(label: string): boolean {
  if (label.trim().length === 0) {
    return false;
  }
  return true;
}
