import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `docs/cards/D138.md`'s security check: "Never AsyncStorage for tokens —
 * platform secure storage only." A static tripwire (same shape as
 * `apps/web/src/security/pageCardFieldGuard.test.ts`'s PCI SAQ A guard):
 * fails the build if any source under `src/` imports `AsyncStorage` in
 * any form, so the constraint can't quietly regress the way a
 * code-review-only rule could.
 */
const SCAN_ROOT = join(import.meta.dirname, "..");
const SCANNABLE_EXTENSIONS = new Set([".ts", ".tsx"]);
const ASYNC_STORAGE_PATTERN = /@react-native-async-storage\/async-storage|\bAsyncStorage\b/;

function collectScannableFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectScannableFiles(fullPath);
    if (!SCANNABLE_EXTENSIONS.has(extname(entry.name))) return [];
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
    return [fullPath];
  });
}

describe("security: tokens are never stored in AsyncStorage", () => {
  it("flags an AsyncStorage import (scanner self-test)", () => {
    const source = 'import AsyncStorage from "@react-native-async-storage/async-storage";';
    expect(ASYNC_STORAGE_PATTERN.test(source)).toBe(true);
  });

  it("no source file under src/ references AsyncStorage in any form", () => {
    const offenders = collectScannableFiles(SCAN_ROOT)
      .map((file) => ({ file, source: readFileSync(file, "utf-8") }))
      .filter(({ source }) => ASYNC_STORAGE_PATTERN.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
