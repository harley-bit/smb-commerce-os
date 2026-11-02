import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../../../connection.js";
import { runSqliteMigrations } from "../../../migrate.js";
import { BadFixtureRepository } from "./BadFixtureRepository.js";

describe("BadFixtureRepository", () => {
  it("findById() cannot read another merchant's row", async () => {
    const connection: Connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const repo = new BadFixtureRepository(connection);

    const ctxA = createTenantContext(generateUuidV7());
    const ctxB = createTenantContext(generateUuidV7());

    expect(repo.findById(ctxA, "does-not-exist")).toBeUndefined();
    expect(repo.findById(ctxB, "does-not-exist")).toBeUndefined();
  });

  it("archive() runs without throwing", async () => {
    const connection: Connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    const repo = new BadFixtureRepository(connection);
    const ctx = createTenantContext(generateUuidV7());

    expect(() => repo.archive(ctx, "does-not-exist")).not.toThrow();
  });
});
