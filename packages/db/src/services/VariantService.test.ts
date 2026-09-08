import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { VariantRepository } from "../repositories/VariantRepository.js";
import { VariantService, type CreateVariantInput } from "./VariantService.js";

describe("VariantService", () => {
  let connection: Connection;
  let listingRepo: ListingRepository;
  let service: VariantService;
  let merchantA: string;
  let productListingA: string;
  let serviceListingA: string;
  let rentalListingA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    listingRepo = new ListingRepository(connection);
    service = new VariantService(new VariantRepository(connection));

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

    const ctx = createTenantContext(merchantA);
    productListingA = listingRepo.create(ctx, {
      mode: "PRODUCT",
      name: "A Product Listing",
      slug: "a-product-listing",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    serviceListingA = listingRepo.create(ctx, {
      mode: "SERVICE",
      name: "A Service Listing",
      slug: "a-service-listing",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    rentalListingA = listingRepo.create(ctx, {
      mode: "RENTAL",
      name: "A Rental Listing",
      slug: "a-rental-listing",
      status: "DRAFT",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  });

  it("creates a PRODUCT variant", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.create(ctx, "OWNER", {
      listingId: productListingA,
      mode: "PRODUCT",
      sku: "SKU-1",
      name: "Small",
      priceMinor: 1999,
      currency: "USD",
    });

    expect(service.findById(ctx, id)).toMatchObject({ sku: "SKU-1", mode: "PRODUCT" });
  });

  it("creates a SERVICE variant carrying durationMinutes", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.create(ctx, "OWNER", {
      listingId: serviceListingA,
      mode: "SERVICE",
      sku: "SVC-1",
      name: "Haircut",
      priceMinor: 4500,
      currency: "USD",
      durationMinutes: 30,
    });

    expect(service.findById(ctx, id)).toMatchObject({ mode: "SERVICE", durationMinutes: 30 });
  });

  it("creates a RENTAL variant carrying ratePeriod, depositMinor, and bufferMinutes", () => {
    const ctx = createTenantContext(merchantA);

    const id = service.create(ctx, "OWNER", {
      listingId: rentalListingA,
      mode: "RENTAL",
      sku: "RNT-1",
      name: "Tent",
      priceMinor: 2500,
      currency: "USD",
      ratePeriod: "DAY",
      depositMinor: 10000,
      bufferMinutes: 30,
    });

    expect(service.findById(ctx, id)).toMatchObject({
      mode: "RENTAL",
      ratePeriod: "DAY",
      depositMinor: 10000,
      bufferMinutes: 30,
    });
  });

  it.each(["durationMinutes", "ratePeriod", "depositMinor", "bufferMinutes"])(
    "rejects a PRODUCT variant carrying the service/rental-only field %s",
    (forbiddenKey) => {
      const ctx = createTenantContext(merchantA);

      const input = {
        listingId: productListingA,
        mode: "PRODUCT",
        sku: "SKU-1",
        name: "Small",
        priceMinor: 1999,
        currency: "USD",
        [forbiddenKey]: forbiddenKey === "ratePeriod" ? "DAY" : 30,
      } as unknown as CreateVariantInput;

      expect(() => service.create(ctx, "OWNER", input)).toThrow(
        new RegExp(`PRODUCT variants.*${forbiddenKey}`, "i"),
      );
    },
  );

  it.each(["ratePeriod", "depositMinor", "bufferMinutes"])(
    "rejects a SERVICE variant carrying the rental-only field %s",
    (forbiddenKey) => {
      const ctx = createTenantContext(merchantA);

      const input = {
        listingId: serviceListingA,
        mode: "SERVICE",
        sku: "SVC-1",
        name: "Haircut",
        priceMinor: 4500,
        currency: "USD",
        [forbiddenKey]: forbiddenKey === "ratePeriod" ? "DAY" : 10000,
      } as unknown as CreateVariantInput;

      expect(() => service.create(ctx, "OWNER", input)).toThrow(
        new RegExp(`SERVICE variants.*${forbiddenKey}`, "i"),
      );
    },
  );

  it("rejects a RENTAL variant carrying the service-only field durationMinutes", () => {
    const ctx = createTenantContext(merchantA);

    const input = {
      listingId: rentalListingA,
      mode: "RENTAL",
      sku: "RNT-1",
      name: "Tent",
      priceMinor: 2500,
      currency: "USD",
      durationMinutes: 30,
    } as unknown as CreateVariantInput;

    expect(() => service.create(ctx, "OWNER", input)).toThrow(/RENTAL variants.*durationMinutes/i);
  });

  it("STAFF cannot create a variant — authorization asserted before any write", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.create(ctx, "STAFF", {
        listingId: productListingA,
        mode: "PRODUCT",
        sku: "SKU-1",
        name: "Small",
        priceMinor: 1999,
        currency: "USD",
      }),
    ).toThrow(/restricted to OWNER or ADMIN/);
  });

  it("authorization is checked even when the payload also carries a forbidden field", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.create(ctx, "STAFF", {
        listingId: productListingA,
        mode: "PRODUCT",
        sku: "SKU-1",
        name: "Small",
        priceMinor: 1999,
        currency: "USD",
        durationMinutes: 30,
      } as unknown as CreateVariantInput),
    ).toThrow(/restricted to OWNER or ADMIN/);
  });

  it("rejects a non-integer priceMinor — price is server-validated, never trusted raw", () => {
    const ctx = createTenantContext(merchantA);

    expect(() =>
      service.create(ctx, "OWNER", {
        listingId: productListingA,
        mode: "PRODUCT",
        sku: "SKU-1",
        name: "Small",
        priceMinor: 19.99,
        currency: "USD",
      }),
    ).toThrow(/integer minor-unit value/);
  });

  it("rejects an update() patch that would push priceMinor to a non-integer value", () => {
    const ctx = createTenantContext(merchantA);
    const id = service.create(ctx, "OWNER", {
      listingId: productListingA,
      mode: "PRODUCT",
      sku: "SKU-1",
      name: "Small",
      priceMinor: 1999,
      currency: "USD",
    });

    expect(() => service.update(ctx, "OWNER", id, { priceMinor: 20.5 })).toThrow(
      /integer minor-unit value/,
    );
    expect(service.findById(ctx, id)?.priceMinor).toBe(1999);
  });

  it("update() validates a legitimate priceMinor change", () => {
    const ctx = createTenantContext(merchantA);
    const id = service.create(ctx, "OWNER", {
      listingId: productListingA,
      mode: "PRODUCT",
      sku: "SKU-1",
      name: "Small",
      priceMinor: 1999,
      currency: "USD",
    });

    service.update(ctx, "OWNER", id, { priceMinor: 2500 });

    expect(service.findById(ctx, id)?.priceMinor).toBe(2500);
  });

  it("archives a variant", () => {
    const ctx = createTenantContext(merchantA);
    const id = service.create(ctx, "OWNER", {
      listingId: productListingA,
      mode: "PRODUCT",
      sku: "SKU-1",
      name: "Small",
      priceMinor: 1999,
      currency: "USD",
    });

    service.archive(ctx, "OWNER", id, "2026-09-09T00:00:00.000Z");

    expect(service.findById(ctx, id)?.archivedAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("listByListing() returns all variants for a listing", () => {
    const ctx = createTenantContext(merchantA);
    service.create(ctx, "OWNER", {
      listingId: productListingA,
      mode: "PRODUCT",
      sku: "SKU-1",
      name: "Small",
      priceMinor: 1999,
      currency: "USD",
    });
    service.create(ctx, "OWNER", {
      listingId: productListingA,
      mode: "PRODUCT",
      sku: "SKU-2",
      name: "Large",
      priceMinor: 2499,
      currency: "USD",
    });

    expect(service.listByListing(ctx, productListingA).map((v) => v.sku)).toEqual([
      "SKU-1",
      "SKU-2",
    ]);
  });
});
