import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findIsolationCoverageGaps, listTenantScopedMethods } from "./isolation-coverage.js";

const fixturesDir = join(import.meta.dirname, "test-fixtures/repositories");
const realRepositoriesDir = join(import.meta.dirname, "../repositories");

describe("listTenantScopedMethods", () => {
  it("finds every public RepositoryMethod on a TenantScopedRepository subclass", () => {
    const methods = listTenantScopedMethods(join(fixturesDir, "BadFixtureRepository.ts"));

    expect(methods.map((m) => m.methodName).sort()).toEqual(["archive", "findById"]);
    expect(methods.every((m) => m.className === "BadFixtureRepository")).toBe(true);
  });
});

describe("findIsolationCoverageGaps — the D021 generator", () => {
  it("reports zero gaps for a repository whose every method has isolation-test evidence", () => {
    const gaps = findIsolationCoverageGaps(fixturesDir).filter(
      (g) => g.className === "GoodFixtureRepository",
    );

    expect(gaps).toEqual([]);
  });

  it("acceptance criterion: a new repository method with no isolation test is reported as a gap", () => {
    const gaps = findIsolationCoverageGaps(fixturesDir).filter(
      (g) => g.className === "BadFixtureRepository",
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      className: "BadFixtureRepository",
      methodName: "archive",
    });
  });

  it("finds zero gaps across every real tenant-scoped repository in packages/db/src/repositories", () => {
    const gaps = findIsolationCoverageGaps(realRepositoriesDir);

    expect(gaps).toEqual([]);
  });
});
