import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("../../../.githooks/commit-msg", import.meta.url));

let workDir: string | undefined;

function runHook(message: string): { status: number; stderr: string } {
  workDir = mkdtempSync(join(tmpdir(), "commit-msg-test-"));
  const messageFile = join(workDir, "COMMIT_EDITMSG");
  writeFileSync(messageFile, message, "utf8");

  try {
    execFileSync("sh", [hookPath, messageFile], { stdio: "pipe" });
    return { status: 0, stderr: "" };
  } catch (error) {
    const err = error as { status: number; stderr: Buffer };
    return { status: err.status, stderr: err.stderr.toString("utf8") };
  }
}

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

describe("commit-msg hook (.githooks/commit-msg)", () => {
  it("accepts a conventional commit with a scope and day-ID suffix", () => {
    const result = runHook("feat(security): add semgrep SAST scanning to CI [D008]");
    expect(result.status).toBe(0);
  });

  it("accepts a conventional commit with no scope and no day-ID suffix", () => {
    const result = runHook("docs: refresh project context snapshot");
    expect(result.status).toBe(0);
  });

  it("rejects a message with no conventional-commit type", () => {
    const result = runHook("added some stuff");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/conventional commit/i);
  });

  it("rejects an unknown type", () => {
    const result = runHook("feature(security): add a thing");
    expect(result.status).not.toBe(0);
  });

  it("rejects a type with no description", () => {
    const result = runHook("fix:");
    expect(result.status).not.toBe(0);
  });
});
