import { describe, expect, it } from "vitest";
import {
  AvailabilityCache,
  AvailabilityRuleRepository,
  LocationRepository,
  MerchantRepository,
  ReservationRepository,
  ResourceRepository,
  createConnection,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { buildApp } from "../src/app";

const CREATED_AT = "2026-09-08T00:00:00.000Z";
// 2026-10-05 is a Monday.
const MONDAY = "2026-10-05T00:00:00.000Z";
const NEXT_MONDAY = "2026-10-12T00:00:00.000Z";

interface Fixture {
  connection: Connection;
  cache: AvailabilityCache;
  slug: string;
  merchantId: string;
  resourceId: string;
}

async function setupFixture(): Promise<Fixture> {
  const connection = createConnection(":memory:");
  await runSqliteMigrations(connection);
  const cache = new AvailabilityCache();

  const merchants = new MerchantRepository(connection);
  const ctx = createTenantContext(generateUuidV7());
  const slug = `acme-${generateUuidV7()}`;
  merchants.create(ctx, { name: "Acme", slug, status: "ACTIVE", defaultCurrency: "USD", createdAt: CREATED_AT });

  const locations = new LocationRepository(connection);
  const locationId = locations.create(ctx, { name: "Main", timezone: "UTC" });
  const resources = new ResourceRepository(connection);
  const resourceId = resources.create(ctx, { locationId, kind: "STAFF", name: "Jane", capacity: 1 });
  const rules = new AvailabilityRuleRepository(connection);
  rules.create(ctx, { resourceId, weekday: 1, startTime: "09:00", endTime: "17:00" });

  return { connection, cache, slug, merchantId: ctx.merchantId, resourceId };
}

describe("GET /v1/m/:slug/availability", () => {
  it("returns free intervals without requiring authentication", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection, availabilityCache: fx.cache });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/availability?resourceId=${fx.resourceId}&from=${MONDAY}&to=${NEXT_MONDAY}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      free: [{ start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T17:00:00.000Z" }],
    });
  });

  it("never reveals who booked a slot in the response body", async () => {
    const fx = await setupFixture();
    const reservations = new ReservationRepository(fx.connection, fx.cache);
    reservations.createGuarded(createTenantContext(fx.merchantId), {
      subjectType: "RESOURCE",
      subjectId: fx.resourceId,
      startsAt: "2026-10-05T10:00:00.000Z",
      endsAt: "2026-10-05T11:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });
    const app = buildApp({ connection: fx.connection, availabilityCache: fx.cache });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/availability?resourceId=${fx.resourceId}&from=${MONDAY}&to=${NEXT_MONDAY}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("subjectId");
    expect(res.body).not.toContain("customer");
  });

  it("rejects a window wider than 90 days with 400", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection, availabilityCache: fx.cache });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/availability?resourceId=${fx.resourceId}&from=2026-01-01T00:00:00.000Z&to=2026-04-15T00:00:00.000Z`,
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown merchant slug", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection, availabilityCache: fx.cache });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/does-not-exist/availability?resourceId=${fx.resourceId}&from=${MONDAY}&to=${NEXT_MONDAY}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for an unknown resource id", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection, availabilityCache: fx.cache });

    const res = await app.inject({
      method: "GET",
      url: `/v1/m/${fx.slug}/availability?resourceId=${generateUuidV7()}&from=${MONDAY}&to=${NEXT_MONDAY}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects a request missing required query params with 400", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection, availabilityCache: fx.cache });

    const res = await app.inject({ method: "GET", url: `/v1/m/${fx.slug}/availability` });

    expect(res.statusCode).toBe(400);
  });

  it("acceptance criterion — cache is invalidated on any reservation write for that subject", async () => {
    const fx = await setupFixture();
    const app = buildApp({ connection: fx.connection, availabilityCache: fx.cache });
    const url = `/v1/m/${fx.slug}/availability?resourceId=${fx.resourceId}&from=${MONDAY}&to=${NEXT_MONDAY}`;

    const before = await app.inject({ method: "GET", url });
    expect(before.json()).toEqual({
      free: [{ start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T17:00:00.000Z" }],
    });

    const reservations = new ReservationRepository(fx.connection, fx.cache);
    reservations.createGuarded(createTenantContext(fx.merchantId), {
      subjectType: "RESOURCE",
      subjectId: fx.resourceId,
      startsAt: "2026-10-05T10:00:00.000Z",
      endsAt: "2026-10-05T11:00:00.000Z",
      quantity: 1,
      state: "CONFIRMED",
      createdAt: CREATED_AT,
    });

    const after = await app.inject({ method: "GET", url });
    expect(after.json()).toEqual({
      free: [
        { start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T10:00:00.000Z" },
        { start: "2026-10-05T11:00:00.000Z", end: "2026-10-05T17:00:00.000Z" },
      ],
    });
  });

  it("this card's security check — the tightest rate limit in the system, per IP", async () => {
    const fx = await setupFixture();
    const app = buildApp({
      connection: fx.connection,
      availabilityCache: fx.cache,
      availabilityRateLimit: { limit: 2, windowMs: 60_000 },
    });
    const url = `/v1/m/${fx.slug}/availability?resourceId=${fx.resourceId}&from=${MONDAY}&to=${NEXT_MONDAY}`;

    expect((await app.inject({ method: "GET", url })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(200);
    const third = await app.inject({ method: "GET", url });
    expect(third.statusCode).toBe(429);
  });
});
