import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(new URL("../../../.github/workflows/ci.yml", import.meta.url));

// AWS access key format — recognized by gitleaks' default ruleset.
const PLANTED_SECRET = "AKIAABCDEFGHIJKLMNOP";

let scratchDir: string | undefined;

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

function runGitleaks(sourceDir: string): { status: number; output: string } {
  const result = spawnSync("gitleaks", ["detect", "--source", sourceDir, "--no-git", "--redact"], {
    encoding: "utf8",
  });
  return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

describe("secret scanning (gitleaks)", () => {
  it("fails on a directory containing a planted secret", () => {
    scratchDir = mkdtempSync(join(tmpdir(), "gitleaks-planted-"));
    writeFileSync(join(scratchDir, "config.env"), `AWS_SECRET_KEY=${PLANTED_SECRET}\n`);

    const result = runGitleaks(scratchDir);

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/leaks found/i);
  });

  it("passes on a directory with no secrets", () => {
    scratchDir = mkdtempSync(join(tmpdir(), "gitleaks-clean-"));
    writeFileSync(join(scratchDir, "notes.md"), "nothing sensitive here\n");

    const result = runGitleaks(scratchDir);

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/no leaks found/i);
  });
});

describe("CI pipeline runs secret scanning (.github/workflows/ci.yml)", () => {
  it("installs gitleaks before the test step", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const gitleaksInstallIndex = workflow.indexOf("gitleaks");
    const testIndex = workflow.indexOf("pnpm test");

    expect(gitleaksInstallIndex).toBeGreaterThan(-1);
    expect(testIndex).toBeGreaterThan(-1);
    expect(gitleaksInstallIndex).toBeLessThan(testIndex);
  });

  it("runs a repo-wide gitleaks scan with a failing exit code on leaks", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/gitleaks detect/);
    expect(workflow).toMatch(/--exit-code 1/);
  });

  it("checks out full git history so gitleaks can scan all commits", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/fetch-depth:\s*0/);
  });
});
