import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(new URL("../../../.github/workflows/ci.yml", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function readWorkflow(): string {
  return readFileSync(workflowPath, "utf8");
}

let scratchDir: string | undefined;

// Async on purpose: each semgrep scan takes ~20s. A synchronous
// `spawnSync` blocks the vitest worker's event loop for that long, so
// vitest's RPC (`onTaskUpdate`) times out and the run is marked failed
// even though every test passed — exactly what happened in CI on PR #7.
function semgrep(args: string[], cwd: string): Promise<{ status: number; output: string }> {
  return new Promise((resolve) => {
    execFile("semgrep", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const err = error as { code?: number | string };
        resolve({ status: typeof err.code === "number" ? err.code : 1, output: `${stdout}${stderr}` });
        return;
      }
      resolve({ status: 0, output: `${stdout}${stderr}` });
    });
  });
}

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("static analysis (semgrep)", () => {
  it("fails (--error) on a fixture with a known high-severity, blocking finding", async () => {
    // Command injection via unsanitized input into child_process.exec — a
    // real blocking rule (javascript.lang.security.detect-child-process),
    // planted here the same way D006/D007 plant a fake secret / vulnerable dep.
    scratchDir = mkdtempSync(join(tmpdir(), "sast-vulnerable-"));
    writeFileSync(
      join(scratchDir, "vuln.js"),
      [
        'const { exec } = require("child_process");',
        "function run(userInput) {",
        '  exec("ls " + userInput);',
        "}",
        "module.exports = { run };",
        "",
      ].join("\n"),
    );

    const scan = await semgrep(["scan", "--config", "p/security-audit", "--error", "."], scratchDir);

    expect(scan.status).not.toBe(0);
    expect(scan.output).toMatch(/blocking/i);
  }, 60_000);

  it("passes clean on a fixture with no findings", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "sast-clean-"));
    writeFileSync(join(scratchDir, "clean.js"), "function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n");

    const scan = await semgrep(["scan", "--config", "p/security-audit", "--error", "."], scratchDir);

    expect(scan.status).toBe(0);
  }, 60_000);

  it("passes clean on this repo's own source tree", async () => {
    const scan = await semgrep(
      ["scan", "--config", "p/security-audit", "--error", "--exclude", "node_modules", "--exclude", "coverage", "--exclude", "dist", "."],
      repoRoot,
    );

    expect(scan.status).toBe(0);
  }, 60_000);
});

describe("CI pipeline runs SAST (.github/workflows/ci.yml)", () => {
  it("runs semgrep with --error after install, before test", () => {
    const workflow = readWorkflow();
    const installIndex = workflow.indexOf("pnpm install --frozen-lockfile");
    const semgrepIndex = workflow.indexOf("semgrep scan");
    const errorFlagIndex = workflow.indexOf("--error");
    const testIndex = workflow.indexOf("pnpm test");

    expect(installIndex).toBeGreaterThan(-1);
    expect(semgrepIndex).toBeGreaterThan(installIndex);
    expect(errorFlagIndex).toBeGreaterThan(semgrepIndex);
    expect(testIndex).toBeGreaterThan(semgrepIndex);
  });
});
