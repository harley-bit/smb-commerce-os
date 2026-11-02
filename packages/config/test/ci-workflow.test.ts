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

/**
 * `docs/design/04` requires the suite to run against both database dialects
 * in CI so a portability failure (e.g. a migration that applies to SQLite
 * but not PostgreSQL) is caught the day it is written, not months later.
 * The main `build` job already covers SQLite (`packages/db`'s dialect
 * tests skip when DATABASE_URL is unset); this asserts a second job runs
 * a real PostgreSQL service container with DATABASE_URL set, so the
 * PostgreSQL-only tests actually execute.
 */
describe("PostgreSQL dialect job (docs/design/04 CI matrix)", () => {
  it("runs a postgres service container", () => {
    const workflow = readWorkflow();
    expect(workflow).toMatch(/image:\s*postgres:16/);
  });

  it("sets DATABASE_URL so the PostgreSQL dialect tests actually run", () => {
    const workflow = readWorkflow();
    expect(workflow).toMatch(/DATABASE_URL:\s*postgres:\/\//);
  });

  it("runs the db package's test suite against the postgres service, through turbo", () => {
    // Through turbo, not `pnpm --filter @smb-os/db test`: turbo.json's
    // `test.dependsOn: ["^build"]` is what builds `@smb-os/domain`'s `dist/`
    // first. The bypass made every db test file fail to resolve
    // `@smb-os/domain` the first time this job actually ran (PR #7,
    // 2026-11-02) — it had never executed on GitHub between D014 and then.
    const workflow = readWorkflow();
    const job = workflow.slice(workflow.indexOf("test-postgres:"));
    expect(job).not.toMatch(/pnpm --filter @smb-os\/db test/);
    expect(job).toMatch(/pnpm turbo run test --filter=@smb-os\/db/);
  });
});
