import { createTenantContext, generateUuidV7, type TenantContext } from "@smb-os/domain";
import {
  AuditLogRepository,
  CartService,
  InventoryService,
  InventoryUnitRepository,
  InventoryMovementRepository,
  ListingRepository,
  ListingResourceRepository,
  LocationRepository,
  MerchantRepository,
  OrderRepository,
  ResourceRepository,
  AvailabilityRuleRepository,
  VariantRepository,
  createConnection,
  runSqliteMigrations,
  sqliteSchema,
  type Connection,
} from "@smb-os/db";

const CREATED_AT = "2026-09-09T00:00:00.000Z";

/**
 * `docs/cards/D136.md` — every E2E flow seeds its merchant/catalog fixture
 * data directly through `@smb-os/db`, the same way every vitest fixture in
 * this repo already does (e.g. `packages/db/src/services/gate-g4.e2e.test.ts`),
 * rather than through the storefront's own HTTP surface. That surface is
 * deliberately incomplete for a customer-driven "browse -> cart" path —
 * `CartService` has never had an HTTP route wired to it (tracked since
 * D126's log, still open as of D135), and neither has
 * `CheckoutDetailsService`/`CheckoutDepositConsentService` (D128/D129) —
 * so a from-scratch browser-only flow structurally cannot exist yet. What
 * *is* real, HTTP- and UI-wired, and what these specs actually drive
 * through a real browser: listing detail pages (product/service/rental),
 * the live availability/slot-picker and deposit-disclosure UI, payment,
 * order confirmation, order history, and cancellation.
 */
export function openE2eConnection(): Connection {
  const dbFile = process.env.E2E_DB_FILE;
  if (!dbFile) {
    throw new Error("E2E_DB_FILE is not set — run this suite through `playwright test`, not directly.");
  }
  return createConnection(dbFile);
}

export interface SeededMerchant {
  connection: Connection;
  ctx: TenantContext;
  merchantId: string;
  slug: string;
  locationId: string;
  /** A `users` row (FK anchor, not a repository — see `@smb-os/db`'s `sqliteSchema` re-export) for movement/audit `actorUserId` fields. */
  staffUserId: string;
}

export async function seedMerchant(): Promise<SeededMerchant> {
  const connection = openE2eConnection();
  await runSqliteMigrations(connection);

  const merchantId = generateUuidV7();
  const slug = `e2e-merchant-${generateUuidV7()}`;
  const ctx = createTenantContext(merchantId);
  const merchants = new MerchantRepository(connection);
  merchants.create(ctx, { name: "E2E Test Merchant", slug, status: "ACTIVE", defaultCurrency: "USD", createdAt: CREATED_AT });
  // `connectAccountId` set directly — Stripe Connect onboarding (D104) has
  // its own dedicated test coverage; these specs aren't testing
  // onboarding, they need a merchant that's already past it so
  // `POST .../payment-intent` doesn't 409 on "payments setup incomplete".
  merchants.update(ctx, { connectAccountId: "acct_e2e_simulated" });

  const staffUserId = generateUuidV7();
  await connection.db
    .insert(sqliteSchema.users)
    .values({ id: staffUserId, email: `staff-${staffUserId}@e2e.example.com`, status: "ACTIVE", createdAt: CREATED_AT });

  const locationId = new LocationRepository(connection).create(ctx, { name: "Main", timezone: "UTC" });

  return { connection, ctx, merchantId, slug, locationId, staffUserId };
}

export interface SeededProduct {
  listingSlug: string;
  listingId: string;
  variantId: string;
}

/** A published PRODUCT listing with in-stock inventory. */
export async function seedProductListing(m: SeededMerchant): Promise<SeededProduct> {
  const listingRepo = new ListingRepository(m.connection);
  const variantRepo = new VariantRepository(m.connection);
  const movementRepo = new InventoryMovementRepository(m.connection);
  const auditLogRepo = new AuditLogRepository(m.connection);
  const inventoryService = new InventoryService(movementRepo, auditLogRepo);

  const listingSlug = `widget-${generateUuidV7()}`;
  const listingId = listingRepo.create(m.ctx, {
    mode: "PRODUCT",
    name: "E2E Widget",
    slug: listingSlug,
    description: "A widget for end-to-end testing.",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const variantId = variantRepo.create(m.ctx, {
    listingId,
    mode: "PRODUCT",
    sku: `WIDGET-${generateUuidV7().slice(0, 8)}`,
    name: "E2E Widget — default",
    priceMinor: 2500,
    currency: "USD",
  });
  inventoryService.receiveStock(m.ctx, "OWNER", {
    variantId,
    locationId: m.locationId,
    quantity: 5,
    note: "E2E seed stock",
    actorUserId: m.staffUserId,
    occurredAt: CREATED_AT,
  });

  return { listingSlug, listingId, variantId };
}

export interface SeededService {
  listingSlug: string;
  listingId: string;
  variantId: string;
  resourceId: string;
}

/** A published SERVICE listing bookable every day of the week, all day — avoids date-of-run flakiness. */
export async function seedServiceListing(m: SeededMerchant): Promise<SeededService> {
  const listingRepo = new ListingRepository(m.connection);
  const variantRepo = new VariantRepository(m.connection);
  const resourceRepo = new ResourceRepository(m.connection);
  const ruleRepo = new AvailabilityRuleRepository(m.connection);
  const listingResourceRepo = new ListingResourceRepository(m.connection);

  const listingSlug = `haircut-${generateUuidV7()}`;
  const listingId = listingRepo.create(m.ctx, {
    mode: "SERVICE",
    name: "E2E Haircut",
    slug: listingSlug,
    description: "A service for end-to-end testing.",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const variantId = variantRepo.create(m.ctx, {
    listingId,
    mode: "SERVICE",
    sku: `HAIRCUT-${generateUuidV7().slice(0, 8)}`,
    name: "E2E Haircut — default",
    priceMinor: 4500,
    currency: "USD",
    durationMinutes: 60,
  });
  const resourceId = resourceRepo.create(m.ctx, { locationId: m.locationId, kind: "STAFF", name: "E2E Stylist", capacity: 1 });
  for (let weekday = 0; weekday < 7; weekday += 1) {
    ruleRepo.create(m.ctx, { resourceId, weekday, startTime: "00:00", endTime: "23:45" });
  }
  listingResourceRepo.assign(m.ctx, { listingId, resourceId, createdAt: CREATED_AT });

  return { listingSlug, listingId, variantId, resourceId };
}

export interface SeededRental {
  listingSlug: string;
  listingId: string;
  variantId: string;
}

/** A published RENTAL listing with one available serialized unit. */
export async function seedRentalListing(m: SeededMerchant): Promise<SeededRental> {
  const listingRepo = new ListingRepository(m.connection);
  const variantRepo = new VariantRepository(m.connection);
  const unitRepo = new InventoryUnitRepository(m.connection);

  const listingSlug = `trailer-${generateUuidV7()}`;
  const listingId = listingRepo.create(m.ctx, {
    mode: "RENTAL",
    name: "E2E Trailer",
    slug: listingSlug,
    description: "A rental for end-to-end testing.",
    status: "PUBLISHED",
    createdAt: CREATED_AT,
  });
  const variantId = variantRepo.create(m.ctx, {
    listingId,
    mode: "RENTAL",
    sku: `TRAILER-${generateUuidV7().slice(0, 8)}`,
    name: "E2E Trailer — default",
    priceMinor: 6000,
    currency: "USD",
    ratePeriod: "DAY",
    depositMinor: 25000,
    bufferMinutes: 0,
  });
  unitRepo.create(m.ctx, {
    variantId,
    locationId: m.locationId,
    unitCode: `TRAILER-UNIT-${generateUuidV7().slice(0, 8)}`,
    trackingMode: "SERIALIZED",
  });

  return { listingSlug, listingId, variantId };
}

export interface SeededCartOrder {
  orderId: string;
}

/**
 * `orders.customer_user_id` is an FK into `packages/db`'s own `users`
 * table — a separate identity space from `apps/api`'s auth layer
 * (`NativeAuthProvider`'s `InMemoryUserRepository`), which is why a
 * customer id minted by `/auth/register` (`../fixtures/auth.ts`) still
 * needs a matching anchor row here before it can own an order. Idempotent
 * (`onConflictDoNothing`) so seeding two orders — or a stranger's order —
 * for the same customer id never double-inserts.
 */
function ensureCustomerUserRow(m: SeededMerchant, customerUserId: string): void {
  m.connection.db
    .insert(sqliteSchema.users)
    .values({ id: customerUserId, email: `${customerUserId}@e2e.example.com`, status: "ACTIVE", createdAt: CREATED_AT })
    .onConflictDoNothing()
    .run();
}

/** A CART-status order with one PRODUCT line, ready for `POST .../payment-intent`. */
export function seedProductCart(m: SeededMerchant, product: SeededProduct, customerUserId: string): SeededCartOrder {
  ensureCustomerUserRow(m, customerUserId);
  const cart = new CartService(new OrderRepository(m.connection), new VariantRepository(m.connection));
  const orderId = cart.createCart(m.ctx, { customerUserId, currency: "USD" });
  cart.addProductLine(m.ctx, { cartId: orderId, variantId: product.variantId, quantity: 1 });
  return { orderId };
}

export function seedServiceCart(
  m: SeededMerchant,
  service: SeededService,
  customerUserId: string,
  startsAt: string,
  endsAt: string,
): SeededCartOrder {
  ensureCustomerUserRow(m, customerUserId);
  const cart = new CartService(new OrderRepository(m.connection), new VariantRepository(m.connection));
  const orderId = cart.createCart(m.ctx, { customerUserId, currency: "USD" });
  cart.addServiceLine(m.ctx, { cartId: orderId, variantId: service.variantId, startsAt, endsAt });
  return { orderId };
}

export function seedRentalCart(
  m: SeededMerchant,
  rental: SeededRental,
  customerUserId: string,
  startsAt: string,
  endsAt: string,
): SeededCartOrder {
  ensureCustomerUserRow(m, customerUserId);
  const cart = new CartService(new OrderRepository(m.connection), new VariantRepository(m.connection));
  const orderId = cart.createCart(m.ctx, { customerUserId, currency: "USD" });
  cart.addRentalLine(m.ctx, { cartId: orderId, variantId: rental.variantId, startsAt, endsAt });
  return { orderId };
}
