import { describe, expect, it } from "vitest";
import { workspaceGraphMarker } from "./index.js";

describe("workspaceGraphMarker", () => {
  it("identifies this package", () => {
    expect(workspaceGraphMarker()).toBe("@smb-os/domain");
  });
});
