import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatePath = fileURLToPath(
  new URL("../../../.github/pull_request_template.md", import.meta.url),
);

function readTemplate(): string {
  return readFileSync(templatePath, "utf8");
}

describe("PR template (.github/pull_request_template.md)", () => {
  it("exists and contains a self-review checklist", () => {
    const template = readTemplate();
    expect(template).toMatch(/self-review/i);
    expect(template).toMatch(/- \[ \]/);
  });

  it("names itself as the CC8 change-management evidence", () => {
    const template = readTemplate();
    expect(template).toMatch(/CC8/);
  });

  it("requires the local gate to have been run before review", () => {
    const template = readTemplate();
    expect(template).toMatch(/lint/i);
    expect(template).toMatch(/typecheck/i);
    expect(template).toMatch(/test/i);
  });
});
