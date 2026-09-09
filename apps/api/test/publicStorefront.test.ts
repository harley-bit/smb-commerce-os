import { describe, expect, it } from "vitest";
import {
  InventoryMovementRepository,
  InventoryUnitRepository,
  ListingRepository,
  ListingResourceRepository,
  ListingService,
  LocationRepository,
  MerchantRepository,
  ReservationRepository,
  ResourceRepository,
  UserRepository,
  VariantRepository,
  VariantService,
  createConnection,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { buildApp } from "../src/app";

const CREATED_AT = "2026-09-08T00:00:00.000Z";

interface Fixture {
  connection: Connection;
  slug: string;
  merchantId: string;
}

async function setupFixture(): Promise<Fixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const merchants = new MerchantRepository(connection);
  const ctx = createTenantContext(generateUuidV7());
  const slug = `acme-${generateUuidV7()}`;
  merchants.create(ctx, {
    name: "Acme",
    slug,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
    legalName: "Acme Legal LLC",
    taxId: "99-9999999",
    businessAddressLine1: "1 Main St",
    businessCity: "Springfield",
    businessState: "IL",
    businessPostalCode: "62704",
    businessCountry: "US",
  });

  const listings = new ListingService(new ListingRepository(connection));
  listings.create(ctx, "OWNER", {
    mode: "PRODUCT",
    name: "Wool Sweater",
    slug: "wool-sweater",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  listings.create(ctx, "OWNER", {
    mode: "SERVICE",
    name: "Haircut",
    slug: "haircut",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  listings.create(ctx, "OWNER", {
    mode: "RENTAL",
    name: "Camping Tent",
    slug: "camping-tent",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  listings.create(ctx, "OWNER", {
    mode: "PRODUCT",
    name: "Unfinished Draft",
    slug: "unfinished-draft",
    status: "DRAFT",
    createdAt: CREATED_AT,
  });

  return { connection, slug, merchantId: ctx.merchantId };
}

interface ProductDetailFixture {
  connection: Connection;
  slug: string;
  merchantId: string;
  inStockVariantId: string;
  outOfStockVariantId: string;
}

async function setupProductDetailFixture(): Promise<ProductDetailFixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const merchants = new MerchantRepository(connection);
  const ctx = createTenantContext(generateUuidV7());
  const slug = `acme-${generateUuidV7()}`;
  merchants.create(ctx, {
    name: "Acme",
    slug,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
  });

  const listings = new ListingService(new ListingRepository(connection));
  const listingId = listings.create(ctx, "OWNER", {
    mode: "PRODUCT",
    name: "Wool Sweater",
    slug: "wool-sweater",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  listings.create(ctx, "OWNER", {
    mode: "PRODUCT",
    name: "Unfinished Draft",
    slug: "unfinished-draft",
    status: "DRAFT",
    createdAt: CREATED_AT,
  });
  listings.create(ctx, "OWNER", {
    mode: "SERVICE",
    name: "Haircut",
    slug: "haircut",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  listings.create(ctx, "OWNER", {
    mode: "RENTAL",
    name: "Camping Tent",
    slug: "camping-tent",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });

  const variants = new VariantService(new VariantRepository(connection));
  const inStockVariantId = variants.create(ctx, "OWNER", {
    listingId,
    mode: "PRODUCT",
    sku: "SWEATER-M",
    name: "Medium",
    priceMinor: 4500,
    currency: "USD",
  });
  const outOfStockVariantId = variants.create(ctx, "OWNER", {
    listingId,
    mode: "PRODUCT",
    sku: "SWEATER-L",
    name: "Large",
    priceMinor: 4500,
    currency: "USD",
  });

  const locations = new LocationRepository(connection);
  const locationId = locations.create(ctx, { name: "Main", timezone: "America/New_York" });

  const users = new UserRepository(connection);
  const actorUserId = users.create({ email: "staff@example.com", status: "ACTIVE", createdAt: CREATED_AT });

  const movements = new InventoryMovementRepository(connection);
  movements.record(ctx, {
    variantId: inStockVariantId,
    locationId,
    kind: "RECEIPT",
    quantity: 25,
    occurredAt: CREATED_AT,
    actorUserId,
    note: "Initial delivery",
  });
  // outOfStockVariantId deliberately gets no RECEIPT — sums to 0.

  return { connection, slug, merchantId: ctx.merchantId, inStockVariantId, outOfStockVariantId };
}

describe("GET /v1/m/:slug/listings/:listingSlug", () => {
  it("returns the product detail with variants and their bucketed stock status", async () => {
    const fx = await setupProductDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/wool-sweater` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; variants: Array<{ id: string; stockStatus: string }> };
    expect(body.name).toBe("Wool Sweater");
    expect(body.variants.find((v) => v.id === fx.inStockVariantId)?.stockStatus).toBe("IN_STOCK");
    expect(body.variants.find((v) => v.id === fx.outOfStockVariantId)?.stockStatus).toBe("OUT_OF_STOCK");
  });

  it("never exposes the raw stock count, merchantId, or listingId on a variant", async () => {
    const fx = await setupProductDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/wool-sweater` });
    const body = res.json() as { variants: Array<Record<string, unknown>> };

    for (const variant of body.variants) {
      expect(variant).not.toHaveProperty("merchantId");
      expect(variant).not.toHaveProperty("listingId");
      expect(variant).not.toHaveProperty("quantityOnHand");
      expect(variant).not.toHaveProperty("stock");
    }
  });

  it("returns 404 for a DRAFT listing's slug", async () => {
    const fx = await setupProductDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/unfinished-draft` });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for an unknown listing slug", async () => {
    const fx = await setupProductDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/no-such-listing` });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for an unknown merchant slug", async () => {
    const fx = await setupProductDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: "/v1/m/no-such-merchant/listings/wool-sweater" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 200 with an empty variants array for a RENTAL listing with no variants — D124 covers RENTAL", async () => {
    const fx = await setupProductDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/camping-tent` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { mode: string; variants: unknown[] };
    expect(body.mode).toBe("RENTAL");
    expect(body.variants).toEqual([]);
  });

  it("rate limits repeated requests from the same IP", async () => {
    const fx = await setupProductDetailFixture();
    const app = buildApp({ connection: fx.connection, publicCatalogRateLimit: { limit: 2, windowMs: 60_000 } });

    await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/wool-sweater` });
    await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/wool-sweater` });
    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/wool-sweater` });

    expect(res.statusCode).toBe(429);
  });
});

interface ServiceDetailFixture {
  connection: Connection;
  slug: string;
  merchantId: string;
  resourceId: string;
}

async function setupServiceDetailFixture(): Promise<ServiceDetailFixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const merchants = new MerchantRepository(connection);
  const ctx = createTenantContext(generateUuidV7());
  const slug = `acme-${generateUuidV7()}`;
  merchants.create(ctx, {
    name: "Acme",
    slug,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
  });

  const listings = new ListingService(new ListingRepository(connection));
  const listingId = listings.create(ctx, "OWNER", {
    mode: "SERVICE",
    name: "Haircut",
    slug: "haircut",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  listings.create(ctx, "OWNER", {
    mode: "SERVICE",
    name: "Unassigned Massage",
    slug: "unassigned-massage",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  listings.create(ctx, "OWNER", {
    mode: "SERVICE",
    name: "Unfinished Consult",
    slug: "unfinished-consult",
    status: "DRAFT",
    createdAt: CREATED_AT,
  });

  const locations = new LocationRepository(connection);
  const locationId = locations.create(ctx, { name: "Main", timezone: "America/New_York" });

  const resources = new ResourceRepository(connection);
  const resourceId = resources.create(ctx, { locationId, kind: "STAFF", name: "Jamie", capacity: 1 });

  const listingResources = new ListingResourceRepository(connection);
  listingResources.assign(ctx, { listingId, resourceId, createdAt: CREATED_AT });

  return { connection, slug, merchantId: ctx.merchantId, resourceId };
}

describe("GET /v1/m/:slug/listings/:listingSlug — SERVICE", () => {
  it("returns the service detail with its resourceIds", async () => {
    const fx = await setupServiceDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/haircut` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; mode: string; resourceIds: string[] };
    expect(body.name).toBe("Haircut");
    expect(body.mode).toBe("SERVICE");
    expect(body.resourceIds).toEqual([fx.resourceId]);
  });

  it("returns an empty resourceIds array for a service with no resource assigned", async () => {
    const fx = await setupServiceDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/unassigned-massage` });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { resourceIds: string[] }).resourceIds).toEqual([]);
  });

  it("never exposes merchantId, listingId, or the resource's own name — this card's security check", async () => {
    const fx = await setupServiceDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/haircut` });
    const body = res.json() as Record<string, unknown>;

    expect(body).not.toHaveProperty("merchantId");
    expect(JSON.stringify(body)).not.toContain("Jamie");
  });

  it("returns 404 for a DRAFT service listing's slug", async () => {
    const fx = await setupServiceDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/unfinished-consult` });

    expect(res.statusCode).toBe(404);
  });
});

interface RentalDetailFixture {
  connection: Connection;
  slug: string;
  merchantId: string;
  variantId: string;
  unit1: string;
  unit2: string;
}

async function setupRentalDetailFixture(): Promise<RentalDetailFixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);

  const merchants = new MerchantRepository(connection);
  const ctx = createTenantContext(generateUuidV7());
  const slug = `acme-${generateUuidV7()}`;
  merchants.create(ctx, {
    name: "Acme",
    slug,
    status: "ACTIVE",
    defaultCurrency: "USD",
    createdAt: CREATED_AT,
  });

  const listings = new ListingService(new ListingRepository(connection));
  const listingId = listings.create(ctx, "OWNER", {
    mode: "RENTAL",
    name: "Camping Tent",
    slug: "camping-tent",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  listings.create(ctx, "OWNER", {
    mode: "RENTAL",
    name: "Unfinished Kayak",
    slug: "unfinished-kayak",
    status: "DRAFT",
    createdAt: CREATED_AT,
  });

  const variants = new VariantService(new VariantRepository(connection));
  const variantId = variants.create(ctx, "OWNER", {
    listingId,
    mode: "RENTAL",
    sku: "TENT-4P",
    name: "4-person tent",
    priceMinor: 3500,
    currency: "USD",
    ratePeriod: "DAY",
    depositMinor: 15000,
    bufferMinutes: 60,
  });

  const locations = new LocationRepository(connection);
  const locationId = locations.create(ctx, { name: "Main", timezone: "America/New_York" });

  const inventoryUnits = new InventoryUnitRepository(connection);
  const unit1 = inventoryUnits.create(ctx, {
    variantId,
    locationId,
    unitCode: "TENT-001",
    trackingMode: "SERIALIZED",
  });
  const unit2 = inventoryUnits.create(ctx, {
    variantId,
    locationId,
    unitCode: "TENT-002",
    trackingMode: "SERIALIZED",
  });

  return { connection, slug, merchantId: ctx.merchantId, variantId, unit1, unit2 };
}

describe("GET /v1/m/:slug/listings/:listingSlug — RENTAL", () => {
  it("returns the rental detail with each variant's deposit and rate period — deposit disclosed before checkout", async () => {
    const fx = await setupRentalDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/camping-tent` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { mode: string; variants: Array<{ id: string; depositMinor: number; ratePeriod: string }> };
    expect(body.mode).toBe("RENTAL");
    expect(body.variants).toEqual([
      expect.objectContaining({ id: fx.variantId, depositMinor: 15000, ratePeriod: "DAY" }),
    ]);
  });

  it("never exposes merchantId, listingId, or any unit id/count on a rental variant — this card's security check", async () => {
    const fx = await setupRentalDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/camping-tent` });
    const body = res.json() as { variants: Array<Record<string, unknown>> };

    for (const variant of body.variants) {
      expect(variant).not.toHaveProperty("merchantId");
      expect(variant).not.toHaveProperty("listingId");
      expect(variant).not.toHaveProperty("unitsAvailable");
      expect(variant).not.toHaveProperty("unitsTotal");
    }
    expect(JSON.stringify(body)).not.toContain(fx.unit1);
    expect(JSON.stringify(body)).not.toContain(fx.unit2);
  });

  it("returns 404 for a DRAFT rental listing's slug", async () => {
    const fx = await setupRentalDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/unfinished-kayak` });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/m/:slug/listings/:listingSlug/rental-availability", () => {
  it("reports available:true when a free unit exists for the requested range", async () => {
    const fx = await setupRentalDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/listings/camping-tent/rental-availability?variantId=${fx.variantId}&from=2026-10-01T00:00:00.000Z&to=2026-10-03T00:00:00.000Z`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true });
  });

  it("reports available:false once every unit is blocked for the requested range — unavailable ranges blocked", async () => {
    const fx = await setupRentalDetailFixture();
    const reservations = new ReservationRepository(fx.connection);
    const ctx = createTenantContext(fx.merchantId);
    for (const unitId of [fx.unit1, fx.unit2]) {
      reservations.createGuarded(
        ctx,
        {
          subjectType: "INVENTORY_UNIT",
          subjectId: unitId,
          startsAt: "2026-10-01T00:00:00.000Z",
          endsAt: "2026-10-03T00:00:00.000Z",
          quantity: 1,
          state: "HELD",
          createdAt: CREATED_AT,
          expiresAt: "2099-01-01T00:00:00.000Z",
          idempotencyKey: `idem-${unitId}`,
        },
        1,
      );
    }
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/listings/camping-tent/rental-availability?variantId=${fx.variantId}&from=2026-10-01T12:00:00.000Z&to=2026-10-02T12:00:00.000Z`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
  });

  it("never exposes which unit was checked or a reservation id — bare boolean only", async () => {
    const fx = await setupRentalDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/listings/camping-tent/rental-availability?variantId=${fx.variantId}&from=2026-10-01T00:00:00.000Z&to=2026-10-03T00:00:00.000Z`,
    });

    expect(Object.keys(res.json() as object)).toEqual(["available"]);
  });

  it("returns 400 when a required query parameter is missing", async () => {
    const fx = await setupRentalDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/listings/camping-tent/rental-availability?variantId=${fx.variantId}`,
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown merchant slug", async () => {
    const fx = await setupRentalDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/no-such-merchant/listings/camping-tent/rental-availability?variantId=${fx.variantId}&from=2026-10-01T00:00:00.000Z&to=2026-10-03T00:00:00.000Z`,
    });

    expect(res.statusCode).toBe(404);
  });

  it("rate limits repeated requests from the same IP at a tight budget", async () => {
    const fx = await setupRentalDetailFixture();
    const app = buildApp({ connection: fx.connection });
    const url = `/v1/m/${fx.slug}/listings/camping-tent/rental-availability?variantId=${fx.variantId}&from=2026-10-01T00:00:00.000Z&to=2026-10-03T00:00:00.000Z`;

    await app.inject({ method: "GET", url });
    await app.inject({ method: "GET", url });
    await app.inject({ method: "GET", url });
    const res = await app.inject({ method: "GET", url });

    expect(res.statusCode).toBe(429);
  });
});

describe("GET /v1/m/:slug", () => {
  it("returns a public profile without requiring authentication", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "Acme", slug: fx.slug, defaultCurrency: "USD" });
  });

  it("never exposes internal id, tax id, legal name, or address", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}` });
    const body = res.json() as Record<string, unknown>;

    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("taxId");
    expect(body).not.toHaveProperty("legalName");
    expect(body).not.toHaveProperty("businessAddressLine1");
    expect(body).not.toHaveProperty("connectAccountId");
  });

  it("returns 404 for an unknown slug", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: "/v1/m/no-such-merchant" });

    expect(res.statusCode).toBe(404);
  });

  it("rate limits repeated requests from the same IP", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection, publicCatalogRateLimit: { limit: 2, windowMs: 60_000 } });

    await app.inject({ method: "GET", url: `/v1/m/${fx.slug}` });
    await app.inject({ method: "GET", url: `/v1/m/${fx.slug}` });
    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}` });

    expect(res.statusCode).toBe(429);
  });
});

describe("GET /v1/m/:slug/listings", () => {
  it("returns the mixed catalog across all three modes on one call", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ mode: string; name: string }>;
    expect(body.map((l) => l.mode).sort()).toEqual(["PRODUCT", "RENTAL", "SERVICE"]);
  });

  it("never returns DRAFT or ARCHIVED listings", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings` });
    const body = res.json() as Array<{ name: string }>;

    expect(body.map((l) => l.name)).not.toContain("Unfinished Draft");
  });

  it("never exposes merchantId or listing status on any listing", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings` });
    const body = res.json() as Array<Record<string, unknown>>;

    for (const listing of body) {
      expect(listing).not.toHaveProperty("merchantId");
      expect(listing).not.toHaveProperty("status");
      expect(listing).not.toHaveProperty("createdAt");
      expect(listing).not.toHaveProperty("archivedAt");
    }
  });

  it("filters by mode via the ?mode query parameter", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?mode=SERVICE` });
    const body = res.json() as Array<{ mode: string; name: string }>;

    expect(body).toEqual([expect.objectContaining({ mode: "SERVICE", name: "Haircut" })]);
  });

  it("rejects an invalid mode filter", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?mode=SUBSCRIPTION` });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown slug", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: "/v1/m/no-such-merchant/listings" });

    expect(res.statusCode).toBe(404);
  });

  it("rate limits repeated requests from the same IP", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection, publicCatalogRateLimit: { limit: 2, windowMs: 60_000 } });

    await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings` });
    await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings` });
    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings` });

    expect(res.statusCode).toBe(429);
  });

  describe("?limit — cursor-based pagination (docs/cards/D141.md)", () => {
    it("returns at most `limit` listings and an X-Next-Cursor header when more remain", async () => {
      const fx = await setupFixture();
      const app = buildApp({ connection: fx.connection });

      const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?limit=2` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string }>;
      expect(body).toHaveLength(2);
      expect(res.headers["x-next-cursor"]).toBe(body[1].id);
    });

    it("walking the cursor forward returns the remaining listings with no X-Next-Cursor header on the last page", async () => {
      const fx = await setupFixture();
      const app = buildApp({ connection: fx.connection });

      const first = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?limit=2` });
      const firstBody = first.json() as Array<{ id: string; name: string }>;
      const cursor = first.headers["x-next-cursor"] as string;

      const second = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?limit=2&cursor=${cursor}` });
      const secondBody = second.json() as Array<{ id: string; name: string }>;

      expect(secondBody).toHaveLength(1);
      expect(second.headers["x-next-cursor"]).toBeUndefined();
      expect([...firstBody, ...secondBody].map((l) => l.name).sort()).toEqual(["Camping Tent", "Haircut", "Wool Sweater"]);
    });

    it("combines the mode filter with pagination", async () => {
      const fx = await setupFixture();
      const app = buildApp({ connection: fx.connection });

      const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?mode=PRODUCT&limit=10` });
      const body = res.json() as Array<{ mode: string }>;

      expect(body.every((l) => l.mode === "PRODUCT")).toBe(true);
    });

    it("rejects a non-positive or non-numeric limit", async () => {
      const fx = await setupFixture();
      const app = buildApp({ connection: fx.connection });

      const zero = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?limit=0` });
      const notANumber = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?limit=abc` });

      expect(zero.statusCode).toBe(400);
      expect(notANumber.statusCode).toBe(400);
    });

    it("has no offset/page query parameter at all — an arbitrary offset-shaped param has no effect", async () => {
      const fx = await setupFixture();
      const app = buildApp({ connection: fx.connection });

      const withOffset = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?limit=2&offset=1` });
      const withoutOffset = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings?limit=2` });

      expect(withOffset.json()).toEqual(withoutOffset.json());
    });
  });
});
