import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(new URL("../../../.github/workflows/ci.yml", import.meta.url));

function readWorkflow(): string {
  return readFileSync(workflowPath, "utf8");
}

let scratchDir: string | undefined;

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("dependency vulnerability scanning (pnpm audit)", () => {
  it("fails at --audit-level=high on a manifest with a known high-severity, fixed vulnerability", () => {
    // form-data@4.0.0 is patched by GHSA-fjxv-7rqg-78g4 (unsafe boundary
    // randomness) at >=4.0.4 — a real high-severity advisory with a fix
    // available, planted here the same way D006 plants a fake secret.
    scratchDir = mkdtempSync(join(tmpdir(), "audit-vulnerable-"));
    writeFileSync(
      join(scratchDir, "package.json"),
      JSON.stringify({ name: "audit-fixture", version: "0.0.0", dependencies: { "form-data": "4.0.0" } }),
    );

    const install = spawnSync("pnpm", ["install", "--no-frozen-lockfile"], { cwd: scratchDir, encoding: "utf8" });
    expect(install.status).toBe(0);

    const audit = spawnSync("pnpm", ["audit", "--audit-level=high"], { cwd: scratchDir, encoding: "utf8" });

    expect(audit.status).not.toBe(0);
    expect(`${audit.stdout}${audit.stderr}`).toMatch(/high|critical/i);
  }, 30_000);

  it("passes clean on this repo's own dependency tree", () => {
    const audit = spawnSync("pnpm", ["audit", "--audit-level=high"], { encoding: "utf8" });

    expect(audit.status).toBe(0);
  }, 30_000);
});

describe("CI pipeline runs dependency scanning (.github/workflows/ci.yml)", () => {
  it("runs pnpm audit at high severity after install, before test", () => {
    const workflow = readWorkflow();
    const installIndex = workflow.indexOf("pnpm install --frozen-lockfile");
    const auditIndex = workflow.indexOf("pnpm audit --audit-level=high");
    const testIndex = workflow.indexOf("pnpm test");

    expect(installIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(installIndex);
    expect(testIndex).toBeGreaterThan(auditIndex);
  });
});

describe("SBOM generation (syft, CycloneDX)", () => {
  it("produces a valid CycloneDX SBOM for a directory", () => {
    scratchDir = mkdtempSync(join(tmpdir(), "sbom-"));
    const sbomPath = join(scratchDir, "sbom.json");
    writeFileSync(
      join(scratchDir, "package.json"),
      JSON.stringify({ name: "sbom-fixture", version: "0.0.0", dependencies: {} }),
    );

    const result = spawnSync("syft", ["dir:.", "-o", `cyclonedx-json=${sbomPath}`], {
      cwd: scratchDir,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);

    const sbom = JSON.parse(readFileSync(sbomPath, "utf8")) as { bomFormat?: string; specVersion?: string };
    expect(sbom.bomFormat).toBe("CycloneDX");
    expect(sbom.specVersion).toBeTruthy();
  }, 30_000);
});

describe("CI pipeline generates and retains an SBOM (.github/workflows/ci.yml)", () => {
  it("installs syft before generating the SBOM", () => {
    const workflow = readWorkflow();
    const syftInstallIndex = workflow.indexOf("syft");
    const sbomGenerateIndex = workflow.indexOf("cyclonedx-json");

    expect(syftInstallIndex).toBeGreaterThan(-1);
    expect(sbomGenerateIndex).toBeGreaterThan(syftInstallIndex);
  });

  it("uploads the generated SBOM as a retained build artifact", () => {
    const workflow = readWorkflow();
    const sbomGenerateIndex = workflow.indexOf("cyclonedx-json");
    const uploadIndex = workflow.indexOf("actions/upload-artifact");

    expect(uploadIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(sbomGenerateIndex);
    expect(workflow).toMatch(/sbom\.json/);
  });
});
