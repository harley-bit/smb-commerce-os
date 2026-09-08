import { generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import { UserRepository } from "./UserRepository.js";

describe("UserRepository", () => {
  let connection: Connection;
  let repo: UserRepository;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new UserRepository(connection);
  });

  it("creates a user and finds it by id", () => {
    const id = repo.create({
      email: "owner@acme.test",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(repo.findById(id)).toMatchObject({
      id,
      email: "owner@acme.test",
      status: "ACTIVE",
    });
  });

  it("finds a user by email", () => {
    repo.create({
      email: "staff@acme.test",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(repo.findByEmail("staff@acme.test")?.email).toBe("staff@acme.test");
  });

  it("returns undefined for an email that doesn't exist", () => {
    expect(repo.findByEmail("nobody@acme.test")).toBeUndefined();
  });

  it("rejects a second user with the same email", () => {
    repo.create({
      email: "dupe@acme.test",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(() =>
      repo.create({
        email: "dupe@acme.test",
        status: "ACTIVE",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("uses a real UUIDv7 as the generated id", () => {
    const id = repo.create({
      email: "uuid-check@acme.test",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(id).not.toBe(generateUuidV7());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
