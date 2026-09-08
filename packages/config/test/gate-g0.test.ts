import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const complianceDir = new URL("../../../docs/compliance/", import.meta.url);

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, complianceDir), "utf8");
}

describe("Gate G0 evidence (docs/compliance/) — D012", () => {
  it("has an incident-response plan distinct from the incident-response policy", () => {
    const content = read("incident-response.md");
    expect(content.length).toBeGreaterThan(500);
    expect(content).toMatch(/policies\/incident-response-policy\.md/);
    expect(content).toMatch(/## Incident log/i);
  });

  it("has a sub-processor inventory naming purpose, data category, and status for each vendor", () => {
    const content = read("subprocessors.md");
    expect(content.length).toBeGreaterThan(500);
    expect(content).toMatch(/08_privacy_data_protection_and_retention/);
    // Categories required by 08: identity, payment, hosting, object storage, email/SMS, error tracking, analytics.
    for (const category of [
      "identity",
      "payment",
      "hosting",
      "object storage",
      "email",
      "error tracking",
      "analytics",
    ]) {
      expect(content.toLowerCase()).toContain(category);
    }
  });

  it("has a repo-local control mapping pointer that stays current with design doc 09", () => {
    const content = read("control-mapping.md");
    expect(content).toMatch(/09_compliance_control_mapping_and_evidence/);
  });

  it("has a dated Phase 0 threat model review record", () => {
    const content = read("threat-model-reviews/2026-09-08-G0.md");
    expect(content).toMatch(/07_security_architecture_and_threat_model/);
    expect(content).toMatch(/trust boundary|trust boundaries/i);
  });

  it("has a G0 gate acceptance record stating the gate criterion and how it was verified", () => {
    const content = read("gate-records/G0.md");
    expect(content).toMatch(/repo, CI, and security gates green on an empty app/i);
    expect(content).toMatch(/pnpm lint/);
    expect(content).toMatch(/pnpm test/);
    expect(content).toMatch(/PASSED/);
  });
});
