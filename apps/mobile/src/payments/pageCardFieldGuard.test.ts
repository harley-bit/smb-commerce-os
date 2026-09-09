import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { scanSourceForCardFields } from "./cardFieldScanner.js";

const SCAN_ROOT = join(import.meta.dirname, "..");
const SCANNABLE_EXTENSIONS = new Set([".ts", ".tsx"]);

function collectScannableFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectScannableFiles(fullPath);
    if (!SCANNABLE_EXTENSIONS.has(extname(entry.name))) return [];
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
    return [fullPath];
  });
}

describe("PCI SAQ A: no card fields in our mobile UI (docs/cards/D146.md)", () => {
  it("flags a raw card-number TextInput (scanner self-test)", () => {
    const source = '<TextInput textContentType="creditCardNumber" />';
    expect(scanSourceForCardFields("fixture.tsx", source)).toHaveLength(1);
  });

  it("flags a raw CVC-shaped TextInput even without a textContentType hint", () => {
    const source = '<TextInput testID="cardCvc" />';
    expect(scanSourceForCardFields("fixture.tsx", source)).toHaveLength(1);
  });

  it("does not flag a hosted-fields mount point", () => {
    const source = '<View testID="hosted-card-field" />';
    expect(scanSourceForCardFields("fixture.tsx", source)).toHaveLength(0);
  });

  it("does not flag unrelated form fields", () => {
    const source = '<TextInput autoComplete="email" />';
    expect(scanSourceForCardFields("fixture.tsx", source)).toHaveLength(0);
  });

  it("fails the build if any source under apps/mobile/src adds a card TextInput field", () => {
    const files = collectScannableFiles(SCAN_ROOT);
    const violations = files.flatMap((file) => scanSourceForCardFields(file, readFileSync(file, "utf-8")));
    expect(violations).toEqual([]);
  });
});
