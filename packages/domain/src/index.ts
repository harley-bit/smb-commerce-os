export function workspaceGraphMarker(): string {
  return "@smb-os/domain";
}

export function isNonEmptyLabel(label: string): boolean {
  if (label.trim().length === 0) {
    return false;
  }
  return true;
}
