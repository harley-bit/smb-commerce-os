import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { scanSourceForCardFields } from "./cardFieldScanner";

const SCAN_ROOT = join(import.meta.dirname, "..");
const SCANNABLE_EXTENSIONS = new Set([".ts", ".tsx", ".html"]);

function collectScannableFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectScannableFiles(fullPath);
    if (!SCANNABLE_EXTENSIONS.has(extname(entry.name))) return [];
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
    return [fullPath];
  });
}

describe("PCI SAQ A: no card fields in our DOM", () => {
  it("flags a raw card-number input field (scanner self-test)", () => {
    const source = '<input type="text" name="cardNumber" autocomplete="cc-number" />';
    expect(scanSourceForCardFields("fixture.tsx", source)).toHaveLength(1);
  });

  it("flags a raw CVC input field even without an autocomplete attribute", () => {
    const source = '<input type="text" id="cvc" />';
    expect(scanSourceForCardFields("fixture.tsx", source)).toHaveLength(1);
  });

  it("does not flag a Stripe Elements/hosted-fields mount point", () => {
    const source = '<div id="card-element"></div>';
    expect(scanSourceForCardFields("fixture.tsx", source)).toHaveLength(0);
  });

  it("does not flag unrelated form fields", () => {
    const source = '<input type="email" name="email" autocomplete="email" />';
    expect(scanSourceForCardFields("fixture.tsx", source)).toHaveLength(0);
  });

  it("fails the build if any page source under apps/web/src adds a card input field", () => {
    const files = collectScannableFiles(SCAN_ROOT);
    const violations = files.flatMap((file) =>
      scanSourceForCardFields(file, readFileSync(file, "utf-8")),
    );
    expect(violations).toEqual([]);
  });
});
