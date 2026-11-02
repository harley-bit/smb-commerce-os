import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { findLocalSigningArtifacts, validateRemoteCredentials } from "./signingCredentials.js";

const easJsonPath = fileURLToPath(new URL("../../eas.json", import.meta.url));
const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));

let scratchDir: string | undefined;

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("validateRemoteCredentials", () => {
  it("passes when every build profile uses EAS-managed remote credentials on both platforms", () => {
    const config = {
      build: {
        development: { ios: { credentialsSource: "remote" }, android: { credentialsSource: "remote" } },
        preview: { ios: { credentialsSource: "remote" }, android: { credentialsSource: "remote" } },
        production: { ios: { credentialsSource: "remote" }, android: { credentialsSource: "remote" } },
      },
    };

    const result = validateRemoteCredentials(config);

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("fails a profile that points at a local credentials file instead of the remote store", () => {
    const config = {
      build: {
        production: { ios: { credentialsSource: "local" }, android: { credentialsSource: "remote" } },
      },
    };

    const result = validateRemoteCredentials(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["build.production.ios: credentialsSource must be \"remote\", got \"local\""]);
  });

  it("fails a profile missing credentialsSource on either platform", () => {
    const config = { build: { preview: { ios: { credentialsSource: "remote" }, android: {} } } };

    const result = validateRemoteCredentials(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["build.preview.android: credentialsSource must be \"remote\", got undefined"]);
  });

  it("the real apps/mobile/eas.json passes validation", async () => {
    const { readFileSync } = await import("node:fs");
    const config: unknown = JSON.parse(readFileSync(easJsonPath, "utf8"));

    const result = validateRemoteCredentials(config);

    expect(result).toEqual({ valid: true, errors: [] });
  });
});

describe("findLocalSigningArtifacts", () => {
  it("returns nothing for a directory with no key material", () => {
    scratchDir = mkdtempSync(join(tmpdir(), "signing-scan-clean-"));
    writeFileSync(join(scratchDir, "app.json"), "{}\n");

    expect(findLocalSigningArtifacts(scratchDir)).toEqual([]);
  });

  it("flags a committed .p12/.jks/.mobileprovision/.pem file", () => {
    scratchDir = mkdtempSync(join(tmpdir(), "signing-scan-dirty-"));
    writeFileSync(join(scratchDir, "release.jks"), "not a real keystore");
    writeFileSync(join(scratchDir, "AuthKey_ABC123.p8"), "not a real key");

    const found = findLocalSigningArtifacts(scratchDir);

    expect(found.sort()).toEqual(["AuthKey_ABC123.p8", "release.jks"].sort());
  });

  it("skips node_modules", () => {
    scratchDir = mkdtempSync(join(tmpdir(), "signing-scan-nm-"));
    const nm = join(scratchDir, "node_modules", "some-pkg");
    mkdirSync(nm, { recursive: true });
    writeFileSync(join(nm, "vendored.p12"), "irrelevant");

    expect(findLocalSigningArtifacts(scratchDir)).toEqual([]);
  });

  it("the real apps/mobile tree has no committed signing key material", () => {
    expect(findLocalSigningArtifacts(mobileRoot)).toEqual([]);
  });
});
