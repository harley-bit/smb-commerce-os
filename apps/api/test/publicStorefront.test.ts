import { describe, expect, it } from "vitest";
import {
  InventoryMovementRepository,
  ListingRepository,
  ListingResourceRepository,
  ListingService,
  LocationRepository,
  MerchantRepository,
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

  it("returns 404 for a RENTAL listing — D123 covers SERVICE, D124 covers RENTAL", async () => {
    const fx = await setupProductDetailFixture();
    const app = buildApp({ connection: fx.connection });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/listings/camping-tent` });

    expect(res.statusCode).toBe(404);
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
});
