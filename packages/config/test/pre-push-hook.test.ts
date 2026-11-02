import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("../../../.githooks/pre-push", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

let scratchDir: string | undefined;

// Async on purpose: the clean-tree case runs a real `pnpm audit` plus a
// whole-repo semgrep scan (tens of seconds). A synchronous `execFileSync`
// blocks the vitest worker's event loop for that long, so vitest's RPC
// (`onTaskUpdate`) times out and the run is marked failed even though every
// test passed — exactly what happened in CI on PR #7.
function runHook(env: NodeJS.ProcessEnv, cwd: string = repoRoot): Promise<{ status: number; output: string }> {
  return new Promise((resolve) => {
    execFile("sh", [hookPath], { cwd, env, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        const err = error as { code?: number | string };
        resolve({ status: typeof err.code === "number" ? err.code : 1, output: `${stdout}${stderr}` });
        return;
      }
      resolve({ status: 0, output: stdout });
    });
  });
}

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("pre-push hook (.githooks/pre-push)", () => {
  it("passes on this repo's own clean tree (real pnpm audit + real semgrep)", async () => {
    const result = await runHook({ ...process.env });
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/pre-push: clean\./);
  }, 60_000);

  it("blocks the push with a clear message when pnpm is not on PATH", async () => {
    const result = await runHook({ PATH: "/usr/bin:/bin" });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/pnpm is not installed/);
  });

  it("blocks the push with a clear message when semgrep is not on PATH", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "pre-push-shim-"));
    const fakePnpm = join(scratchDir, "pnpm");
    writeFileSync(fakePnpm, '#!/usr/bin/env sh\nexit 0\n');
    chmodSync(fakePnpm, 0o755);

    const result = await runHook({ PATH: `${scratchDir}:/usr/bin:/bin` });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/semgrep is not installed/);
  });
});
