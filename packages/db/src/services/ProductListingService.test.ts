import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { ListingService } from "./ListingService.js";
import { ProductListingService, type CreateProductListingInput } from "./ProductListingService.js";
import type { UpdateListingInput } from "../repositories/ListingRepository.js";

describe("ProductListingService", () => {
  let connection: Connection;
  let service: ProductListingService;
  let merchantA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    service = new ProductListingService(new ListingService(new ListingRepository(connection)));

    merchantA = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values([
      {
        id: merchantA,
        name: "Merchant A",
        slug: "merchant-a",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ]);
  });

  it("creates a PRODUCT listing", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.create(ctx, "OWNER", {
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    expect(service.findById(ctx, id)).toMatchObject({ name: "Wool Sweater", mode: "PRODUCT" });
  });

  it("hardcodes mode to PRODUCT even if a raw payload tries to override it", () => {
    const ctx = createTenantContext(merchantA);

    const tamperedInput = {
      name: "Haircut",
      slug: "haircut",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
      mode: "SERVICE",
    } as unknown as CreateProductListingInput;

    const id = service.create(ctx, "OWNER", tamperedInput);

    expect(service.findById(ctx, id)?.mode).toBe("PRODUCT");
  });

  it.each(["durationMinutes", "ratePeriod", "depositMinor"])(
    "rejects create() payloads carrying the service/rental-only field %s",
    (forbiddenKey) => {
      const ctx = createTenantContext(merchantA);

      const input = {
        name: "Wool Sweater",
        slug: "wool-sweater",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
        [forbiddenKey]: 30,
      } as unknown as CreateProductListingInput;

      expect(() => service.create(ctx, "OWNER", input)).toThrow(
        new RegExp(`PRODUCT listings.*${forbiddenKey}`, "i"),
      );
    },
  );

  it.each(["durationMinutes", "ratePeriod", "depositMinor"])(
    "rejects update() patches carrying the service/rental-only field %s",
    (forbiddenKey) => {
      const ctx = createTenantContext(merchantA);
      const id = service.create(ctx, "OWNER", {
        name: "Wool Sweater",
        slug: "wool-sweater",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      });

      const patch = { name: "Retagged", [forbiddenKey]: 30 } as unknown as UpdateListingInput;

      expect(() => service.update(ctx, "OWNER", id, patch)).toThrow(
        new RegExp(`PRODUCT listings.*${forbiddenKey}`, "i"),
      );
    },
  );

  it("STAFF cannot create a PRODUCT listing — authorization asserted before any write", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.create(ctx, "STAFF", {
        name: "Wool Sweater",
        slug: "wool-sweater",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toThrow(/restricted to OWNER or ADMIN/);
  });

  it("authorization is checked even when the payload also carries a forbidden field", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.create(ctx, "STAFF", {
        name: "Wool Sweater",
        slug: "wool-sweater",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
        durationMinutes: 30,
      } as unknown as CreateProductListingInput),
    ).toThrow(/restricted to OWNER or ADMIN/);
  });

  it("archives a PRODUCT listing", () => {
    const ctx = createTenantContext(merchantA);
    const id = service.create(ctx, "OWNER", {
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    service.archive(ctx, "OWNER", id, "2026-09-09T00:00:00.000Z");

    expect(service.findById(ctx, id)?.archivedAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("update() without a forbidden field succeeds normally", () => {
    const ctx = createTenantContext(merchantA);
    const id = service.create(ctx, "OWNER", {
      name: "Wool Sweater",
      slug: "wool-sweater",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    service.update(ctx, "OWNER", id, { name: "Cotton Sweater" });

    expect(service.findById(ctx, id)?.name).toBe("Cotton Sweater");
  });
});
