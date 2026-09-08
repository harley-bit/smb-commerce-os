import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const baseConfigPath = fileURLToPath(new URL("../tsconfig.base.json", import.meta.url));

/**
 * Type-checks a source snippet against the real shared tsconfig.base.json
 * (not a re-declared copy of its options), so this test fails the moment
 * someone weakens the base config rather than just testing itself.
 */
function diagnosticCodesFor(source: string): number[] {
  const dir = mkdtempSync(join(tmpdir(), "strict-config-"));
  const filePath = join(dir, "fixture.ts");
  writeFileSync(filePath, source);

  try {
    const configFile = ts.readConfigFile(baseConfigPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(baseConfigPath));
    const program = ts.createProgram([filePath], { ...parsed.options, noEmit: true });
    return ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === filePath)
      .map((d) => d.code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("shared strict tsconfig (packages/config/tsconfig.base.json)", () => {
  it("rejects an implicitly-typed parameter (noImplicitAny)", () => {
    const codes = diagnosticCodesFor("export function bad(x) { return x.length; }");
    expect(codes).toContain(7006);
  });

  it("rejects unguarded access on a possibly-null value (strictNullChecks)", () => {
    const codes = diagnosticCodesFor(
      "export function unsafe(value: string | null) { return value.toUpperCase(); }"
    );
    expect(codes).toContain(18047);
  });

  it("rejects unchecked indexed access as a possibly-undefined value (noUncheckedIndexedAccess)", () => {
    const codes = diagnosticCodesFor(
      "export function first(values: string[]): string { return values[0]; }"
    );
    expect(codes.length).toBeGreaterThan(0);
  });

  it("accepts null-safe, explicitly-typed equivalent code", () => {
    const codes = diagnosticCodesFor(
      "export function safe(value: string | null): string { return value?.toUpperCase() ?? \"\"; }"
    );
    expect(codes).toEqual([]);
  });
});
