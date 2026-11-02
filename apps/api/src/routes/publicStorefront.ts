import type { FastifyInstance } from "fastify";
import { createTenantContext } from "@smb-os/domain";
import {
  InventoryMovementRepository,
  InventoryUnitRepository,
  ListingRepository,
  ListingResourceRepository,
  ListingService,
  MerchantRepository,
  ReservationRepository,
  VariantRepository,
  VariantService,
  runSqliteMigrations,
  type Connection,
  type Listing,
  type ListingMode,
  type Variant,
} from "@smb-os/db";
import type {
  PublicListing,
  PublicMerchantProfile,
  PublicProductDetail,
  PublicRentalDetail,
  PublicRentalVariant,
  PublicServiceDetail,
  PublicVariant,
} from "@smb-os/contracts";
import { SlidingWindowRateLimiter } from "../auth/rateLimiter.js";
import { problemType, sendProblem } from "../problemDetails.js";

const LISTING_MODES: readonly ListingMode[] = ["PRODUCT", "SERVICE", "RENTAL"];

interface PublicStorefrontServices {
  merchants: MerchantRepository;
  listings: ListingService;
  variants: VariantService;
  movements: InventoryMovementRepository;
  listingResources: ListingResourceRepository;
  inventoryUnits: InventoryUnitRepository;
  reservations: ReservationRepository;
}

/**
 * Lazily migrates `connection` on first use, same pattern as
 * `./availability.ts` and `./listings.ts` — `buildApp()` is synchronous,
 * migrations are not.
 */
function createServiceFactory(connection: Connection): () => Promise<PublicStorefrontServices> {
  let ready: Promise<PublicStorefrontServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => ({
      merchants: new MerchantRepository(connection),
      listings: new ListingService(new ListingRepository(connection)),
      variants: new VariantService(new VariantRepository(connection)),
      movements: new InventoryMovementRepository(connection),
      listingResources: new ListingResourceRepository(connection),
      inventoryUnits: new InventoryUnitRepository(connection),
      reservations: new ReservationRepository(connection),
    }));
    return ready;
  };
}

function toPublicListing(listing: Listing): PublicListing {
  return {
    id: listing.id,
    mode: listing.mode,
    name: listing.name,
    slug: listing.slug,
    description: listing.description,
  };
}

/**
 * This card's (D122) security check: `stockStatus` is a bucketed enum
 * derived from `InventoryMovementRepository.sumStock` — the raw sum itself
 * (a number a competitor could read off a public page) never leaves this
 * function. Summed across all locations (no `locationId` filter): a
 * storefront visitor cares whether a variant can be ordered at all, not
 * per-location detail.
 */
function toPublicVariant(variant: Variant, stock: number): PublicVariant {
  return {
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    priceMinor: variant.priceMinor,
    currency: variant.currency,
    attributesJson: variant.attributesJson,
    stockStatus: stock > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
  };
}

/**
 * `docs/cards/D124.md`'s deposit-disclosure acceptance criterion: `depositMinor`
 * is carried through unconditionally (whatever `VariantRepository` has —
 * `null` if the merchant never set one) rather than defaulted or omitted, so
 * a storefront visitor sees the real figure before checkout, never a
 * placeholder. No unit id/count leaves this mapper (this card's security
 * check, mirrored from D122's `toPublicVariant`) — `unitsTotal` is never
 * read here at all.
 */
function toPublicRentalVariant(variant: Variant): PublicRentalVariant {
  return {
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    priceMinor: variant.priceMinor,
    currency: variant.currency,
    ratePeriod: variant.ratePeriod,
    depositMinor: variant.depositMinor,
  };
}

export interface RegisterPublicStorefrontRoutesOptions {
  rateLimit?: { limit: number; windowMs: number };
}

/**
 * `docs/design/06`'s public storefront surface — `GET /v1/m/{slug}`
 * (merchant profile) and `GET /v1/m/{slug}/listings` (mixed catalog,
 * filter by `mode`). Unauthenticated by design, same shape as
 * `./availability.ts`: a storefront visitor has no session and no
 * `X-Merchant-Id`, so this resolves its own `TenantContext` from the
 * public `{slug}` and gets its own rate limiter rather than relying on
 * `assertCan`/`app.authenticate` for protection — this card's security
 * check. Every response is built from a narrow `Public*` contract
 * (`@smb-os/contracts`) that never carries the merchant's DB-internal
 * `id`, tax/legal/address fields, or a listing's `status`/timestamps —
 * only `PUBLISHED` listings are ever visible here at all
 * (`ListingService.listPublished`), so a status field would only ever
 * say one thing and would leak that a draft/archived catalog exists.
 */
export function registerPublicStorefrontRoutes(
  app: FastifyInstance,
  connection: Connection,
  options: RegisterPublicStorefrontRoutesOptions = {},
): void {
  const getServices = createServiceFactory(connection);
  const limiter = new SlidingWindowRateLimiter(options.rateLimit?.limit ?? 30, options.rateLimit?.windowMs ?? 60_000);
  // Same tight budget as `./availability.ts` — cheapest to scrape, most
  // expensive to compute, deliberately its own limiter rather than sharing
  // `limiter` above.
  const availabilityLimiter = new SlidingWindowRateLimiter(3, 60_000);

  app.get<{ Params: { slug: string } }>("/v1/m/:slug", async (request, reply) => {
    if (!limiter.consume(`ip:${request.ip}`)) {
      return sendProblem(request, reply, 429, problemType("rate-limited"), "Too Many Requests", "Too many requests. Try again later.");
    }

    const { merchants } = await getServices();
    const merchant = merchants.findBySlug(request.params.slug);
    if (!merchant) {
      return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
    }

    const profile: PublicMerchantProfile = {
      name: merchant.name,
      slug: merchant.slug,
      defaultCurrency: merchant.defaultCurrency,
    };
    return reply.code(200).send(profile);
  });

  /**
   * `docs/cards/D141.md`'s catalog browse pagination: `limit` is optional
   * and, when omitted, this route behaves exactly as before (the whole
   * published catalog in one call) — every existing caller (the web
   * storefront's `MerchantPageView.tsx`, the mobile app's initial `Home`
   * load) is unaffected. When `limit` is given, the response is bounded
   * to that many listings and an `X-Next-Cursor` response header carries
   * the opaque cursor (the last listing's own `id`) for the next page —
   * present only when more listings remain, absent on the last page.
   * This card's security check ("cursor-based, no offset leakage"): there
   * is no `offset`/`page` query parameter anywhere on this route — an
   * arbitrary extra querystring key like `offset` is simply ignored by
   * Fastify's typed querystring parsing, so a caller can only ever walk
   * forward from a cursor it was actually handed, never jump to or infer
   * a numeric position in the catalog.
   */
  app.get<{ Params: { slug: string }; Querystring: { mode?: string; cursor?: string; limit?: string } }>(
    "/v1/m/:slug/listings",
    async (request, reply) => {
      if (!limiter.consume(`ip:${request.ip}`)) {
        return sendProblem(request, reply, 429, problemType("rate-limited"), "Too Many Requests", "Too many requests. Try again later.");
      }

      const { mode, cursor, limit: limitParam } = request.query;
      if (mode !== undefined && !LISTING_MODES.includes(mode as ListingMode)) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "mode must be PRODUCT, SERVICE, or RENTAL.");
      }

      let limit: number | undefined;
      if (limitParam !== undefined) {
        limit = Number(limitParam);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "limit must be an integer between 1 and 100.");
        }
      }

      const { merchants, listings } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
      }

      const ctx = createTenantContext(merchant.id);

      if (limit === undefined) {
        const published = listings
          .listPublished(ctx)
          .filter((listing) => mode === undefined || listing.mode === mode)
          .map(toPublicListing);
        return reply.code(200).send(published);
      }

      const page = listings.listPublishedPage(ctx, { mode: mode as ListingMode | undefined, cursor, limit });
      if (page.nextCursor !== null) {
        reply.header("X-Next-Cursor", page.nextCursor);
      }
      return reply.code(200).send(page.items.map(toPublicListing));
    },
  );

  /**
   * `docs/cards/D122.md`'s product detail page, extended by `docs/cards/D123.md`
   * to also serve SERVICE listings and `docs/cards/D124.md` to also serve
   * RENTAL listings — every listing mode this route can ever return
   * (`LISTING_MODES`) now has a branch, so an unknown mode can no longer
   * reach here undetected. Same unauthenticated + rate-limited +
   * `PUBLISHED`-only posture as the two routes above.
   */
  app.get<{ Params: { slug: string; listingSlug: string } }>(
    "/v1/m/:slug/listings/:listingSlug",
    async (request, reply) => {
      if (!limiter.consume(`ip:${request.ip}`)) {
        return sendProblem(request, reply, 429, problemType("rate-limited"), "Too Many Requests", "Too many requests. Try again later.");
      }

      const { merchants, listings, variants, movements, listingResources } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
      }

      const ctx = createTenantContext(merchant.id);
      const listing = listings.findPublishedBySlug(ctx, request.params.listingSlug);
      if (!listing) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that slug.");
      }

      if (listing.mode === "SERVICE") {
        /**
         * D123's security check: "Availability shows free/busy only, never
         * who booked" — answered one layer down, by `GET
         * /v1/m/{slug}/availability` (`./availability.ts`), which this
         * detail only points at via bare `resourceId`s. This response
         * carries no reservation, staff name, or availability data of its
         * own — a `resourceId` alone identifies nothing about who's booked.
         */
        const detail: PublicServiceDetail = {
          ...toPublicListing(listing),
          resourceIds: listingResources.listByListing(ctx, listing.id).map((assignment) => assignment.resourceId),
        };
        return reply.code(200).send(detail);
      }

      if (listing.mode === "RENTAL") {
        const detail: PublicRentalDetail = {
          ...toPublicListing(listing),
          variants: variants.listByListing(ctx, listing.id).map(toPublicRentalVariant),
        };
        return reply.code(200).send(detail);
      }

      const detail: PublicProductDetail = {
        ...toPublicListing(listing),
        variants: variants
          .listByListing(ctx, listing.id)
          .map((variant) => toPublicVariant(variant, movements.sumStock(ctx, variant.id))),
      };
      return reply.code(200).send(detail);
    },
  );

  /**
   * `docs/cards/D124.md`'s "unavailable ranges blocked" acceptance
   * criterion — a bare boolean, computed the same candidate-narrowing
   * `RentalReservationService.createRentalReservation`
   * (`packages/db/src/services/RentalReservationService.ts`) uses to pick a
   * unit, minus the write: does at least one `AVAILABLE` unit for
   * `variantId` have no blocking reservation over `[from, to)`. Deliberately
   * bypasses `RentalReservationService` itself — that service asserts
   * `bookings:manage`, an authenticated-staff action, and this route has no
   * session (a storefront visitor browsing dates before checkout). Same
   * tight, unauthenticated rate-limit posture as `./availability.ts` (this
   * card's security check's neighbor concern): cheap to scrape, so it gets
   * its own budget rather than the wider catalog-read one above.
   */
  app.get<{
    Params: { slug: string; listingSlug: string };
    Querystring: { variantId?: string; from?: string; to?: string };
  }>("/v1/m/:slug/listings/:listingSlug/rental-availability", async (request, reply) => {
    if (!availabilityLimiter.consume(`ip:${request.ip}`)) {
      return sendProblem(
        request,
        reply,
        429,
        problemType("rate-limited"),
        "Too Many Requests",
        "Too many availability requests. Try again later.",
      );
    }

    const { variantId, from, to } = request.query;
    if (!variantId || !from || !to) {
      return sendProblem(
        request,
        reply,
        400,
        problemType("bad-request"),
        "Bad Request",
        "variantId, from, and to are required query parameters.",
      );
    }

    const { merchants, listings, inventoryUnits, reservations } = await getServices();
    const merchant = merchants.findBySlug(request.params.slug);
    if (!merchant) {
      return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
    }

    const ctx = createTenantContext(merchant.id);
    const listing = listings.findPublishedBySlug(ctx, request.params.listingSlug);
    if (!listing || listing.mode !== "RENTAL") {
      return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that slug.");
    }

    const now = new Date().toISOString();
    const available = inventoryUnits
      .listByVariant(ctx, variantId)
      .filter((unit) => unit.status === "AVAILABLE")
      .some((unit) => reservations.findBlocking(ctx, "INVENTORY_UNIT", unit.id, from, to, now).length === 0);

    return reply.code(200).send({ available });
  });
}
