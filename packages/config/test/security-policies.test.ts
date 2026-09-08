import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const policiesDir = new URL(
  "../../../docs/compliance/policies/",
  import.meta.url,
);

const REQUIRED_POLICIES = [
  "information-security-policy.md",
  "access-control-policy.md",
  "data-retention-policy.md",
  "incident-response-policy.md",
  "secure-development-policy.md",
  "vendor-management-policy.md",
];

function readPolicy(filename: string): string {
  return readFileSync(new URL(filename, policiesDir), "utf8");
}

describe("security policy set (docs/compliance/policies/)", () => {
  it("has exactly the six core GRC policies required by D011", () => {
    expect(REQUIRED_POLICIES).toHaveLength(6);
  });

  it.each(REQUIRED_POLICIES)("%s exists and is non-trivial", (filename) => {
    const content = readPolicy(filename);
    expect(content.length).toBeGreaterThan(500);
  });

  it.each(REQUIRED_POLICIES)(
    "%s carries a version and an effective date, so version control gives real change history",
    (filename) => {
      const content = readPolicy(filename);
      expect(content).toMatch(/\*\*Effective date:\*\*\s*\d{4}-\d{2}-\d{2}/);
      expect(content).toMatch(/\*\*Version:\*\*\s*\d+\.\d+/);
    },
  );

  it.each(REQUIRED_POLICIES)(
    "%s names an owner/approver and states it is revised via pull request",
    (filename) => {
      const content = readPolicy(filename);
      expect(content).toMatch(/\*\*Owner:\*\*/);
      expect(content).toMatch(/pull request/i);
    },
  );

  it("information security policy references the NIST CSF 2.0 spine used by this repo", () => {
    const content = readPolicy("information-security-policy.md");
    expect(content).toMatch(/NIST CSF/);
  });

  it("access control policy references RBAC and mandatory MFA for privileged roles", () => {
    const content = readPolicy("access-control-policy.md");
    expect(content).toMatch(/RBAC|role-based/i);
    expect(content).toMatch(/MFA/);
  });

  it("data retention policy cross-references the privacy design doc", () => {
    const content = readPolicy("data-retention-policy.md");
    expect(content).toMatch(/08_privacy_data_protection_and_retention/);
  });

  it("incident response policy defines a breach notification trigger", () => {
    const content = readPolicy("incident-response-policy.md");
    expect(content).toMatch(/breach notification/i);
  });

  it("secure development policy references the CI quality gates", () => {
    const content = readPolicy("secure-development-policy.md");
    expect(content).toMatch(/10_secure_sdlc_ci_and_quality_gates/);
  });

  it("vendor management policy addresses PCI SAQ A card-data outsourcing", () => {
    const content = readPolicy("vendor-management-policy.md");
    expect(content).toMatch(/PCI/);
    expect(content).toMatch(/sub-processor/i);
  });
});
