import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("../../../.githooks/pre-push", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

let scratchDir: string | undefined;

function runHook(env: NodeJS.ProcessEnv, cwd: string = repoRoot): { status: number; output: string } {
  try {
    const output = execFileSync("sh", [hookPath], { cwd, env, stdio: "pipe" });
    return { status: 0, output: output.toString("utf8") };
  } catch (error) {
    const err = error as { status: number; stdout: Buffer; stderr: Buffer };
    return { status: err.status, output: `${err.stdout}${err.stderr}` };
  }
}

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("pre-push hook (.githooks/pre-push)", () => {
  it("passes on this repo's own clean tree (real pnpm audit + real semgrep)", () => {
    const result = runHook({ ...process.env });
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/pre-push: clean\./);
  }, 60_000);

  it("blocks the push with a clear message when pnpm is not on PATH", () => {
    const result = runHook({ PATH: "/usr/bin:/bin" });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/pnpm is not installed/);
  });

  it("blocks the push with a clear message when semgrep is not on PATH", () => {
    scratchDir = mkdtempSync(join(tmpdir(), "pre-push-shim-"));
    const fakePnpm = join(scratchDir, "pnpm");
    writeFileSync(fakePnpm, '#!/usr/bin/env sh\nexit 0\n');
    chmodSync(fakePnpm, 0o755);

    const result = runHook({ PATH: `${scratchDir}:/usr/bin:/bin` });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/semgrep is not installed/);
  });
});
