import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(new URL("../../../.github/workflows/ci.yml", import.meta.url));

/**
 * The CI workflow file has no compiler to catch structural mistakes, so this
 * test greps its raw text for the properties the D005 acceptance criteria
 * and security check depend on: it must actually run on every PR, it must
 * run install/lint/typecheck/test in that dependency order, and the install
 * step must use a frozen lockfile (the security control against dependency
 * substitution).
 */
function readWorkflow(): string {
  return readFileSync(workflowPath, "utf8");
}

describe("CI pipeline skeleton (.github/workflows/ci.yml)", () => {
  it("triggers on pull requests", () => {
    const workflow = readWorkflow();
    expect(workflow).toMatch(/pull_request:/);
  });

  it("installs dependencies with a frozen lockfile", () => {
    const workflow = readWorkflow();
    expect(workflow).toMatch(/pnpm install --frozen-lockfile/);
  });

  it("runs lint, typecheck, and test after install, in that order", () => {
    const workflow = readWorkflow();
    const installIndex = workflow.indexOf("pnpm install --frozen-lockfile");
    const lintIndex = workflow.indexOf("pnpm lint");
    const typecheckIndex = workflow.indexOf("pnpm typecheck");
    const testIndex = workflow.indexOf("pnpm test");

    expect(installIndex).toBeGreaterThan(-1);
    expect(lintIndex).toBeGreaterThan(installIndex);
    expect(typecheckIndex).toBeGreaterThan(lintIndex);
    expect(testIndex).toBeGreaterThan(typecheckIndex);
  });
});
