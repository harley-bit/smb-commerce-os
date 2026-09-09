import { describe, expect, it } from "vitest";
import {
  ListingRepository,
  ListingService,
  MerchantRepository,
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
