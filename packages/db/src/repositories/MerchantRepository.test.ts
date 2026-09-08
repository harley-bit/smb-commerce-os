import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import { MerchantRepository } from "./MerchantRepository.js";

describe("MerchantRepository", () => {
  let connection: Connection;
  let repo: MerchantRepository;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    repo = new MerchantRepository(connection);
  });

  it("creates a merchant scoped to the caller's own merchant id", () => {
    const ctx = createTenantContext(generateUuidV7());

    repo.create(ctx, {
      name: "Acme Rentals",
      slug: "acme-rentals",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const merchant = repo.findOwn(ctx);
    expect(merchant).toMatchObject({
      id: ctx.merchantId,
      name: "Acme Rentals",
      slug: "acme-rentals",
    });
  });

  it("never returns another merchant's row from findOwn — scoping predicate enforced", () => {
    const ctxA = createTenantContext(generateUuidV7());
    const ctxB = createTenantContext(generateUuidV7());

    repo.create(ctxA, {
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    repo.create(ctxB, {
      name: "Merchant B",
      slug: "merchant-b",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(repo.findOwn(ctxA)?.name).toBe("Merchant A");
    expect(repo.findOwn(ctxB)?.name).toBe("Merchant B");
  });

  it("update() cannot modify another merchant's row", () => {
    const ctxA = createTenantContext(generateUuidV7());
    const ctxB = createTenantContext(generateUuidV7());

    repo.create(ctxA, {
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    repo.create(ctxB, {
      name: "Merchant B",
      slug: "merchant-b",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    repo.update(ctxA, { name: "Merchant A Renamed" });

    expect(repo.findOwn(ctxA)?.name).toBe("Merchant A Renamed");
    expect(repo.findOwn(ctxB)?.name).toBe("Merchant B");
  });

  it("archive() sets archivedAt only on the caller's own row", () => {
    const ctxA = createTenantContext(generateUuidV7());
    const ctxB = createTenantContext(generateUuidV7());

    repo.create(ctxA, {
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    repo.create(ctxB, {
      name: "Merchant B",
      slug: "merchant-b",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    repo.archive(ctxA, "2026-09-09T00:00:00.000Z");

    expect(repo.findOwn(ctxA)?.archivedAt).toBe("2026-09-09T00:00:00.000Z");
    expect(repo.findOwn(ctxB)?.archivedAt).toBeNull();
  });

  describe("findBySlug() — public lookup, no TenantContext (D060)", () => {
    it("resolves a merchant by slug without requiring the caller to already know its id", () => {
      const ctx = createTenantContext(generateUuidV7());
      repo.create(ctx, {
        name: "Acme Rentals",
        slug: "acme-rentals",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      });

      expect(repo.findBySlug("acme-rentals")).toMatchObject({ id: ctx.merchantId, slug: "acme-rentals" });
    });

    it("returns undefined for an unknown slug", () => {
      expect(repo.findBySlug("does-not-exist")).toBeUndefined();
    });
  });
});
