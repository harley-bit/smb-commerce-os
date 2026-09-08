import { describe, expect, it } from "vitest";
import { isNonEmptyLabel, workspaceGraphMarker } from "./index.js";

describe("workspaceGraphMarker", () => {
  it("identifies this package", () => {
    expect(workspaceGraphMarker()).toBe("@smb-os/domain");
  });
});

describe("isNonEmptyLabel", () => {
  it("rejects a blank or whitespace-only label", () => {
    expect(isNonEmptyLabel("   ")).toBe(false);
  });

  it("accepts a label with visible characters", () => {
    expect(isNonEmptyLabel("Widget")).toBe(true);
  });
});
