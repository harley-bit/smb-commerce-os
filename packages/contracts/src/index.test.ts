import { describe, expect, it } from "vitest";
import { contractsPackageMarker } from "./index.js";

describe("contractsPackageMarker", () => {
  it("identifies this package", () => {
    expect(contractsPackageMarker()).toBe("@smb-os/contracts");
  });
});
