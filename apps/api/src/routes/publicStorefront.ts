import type { FastifyInstance } from "fastify";
import { createTenantContext } from "@smb-os/domain";
import {
  InventoryMovementRepository,
  ListingRepository,
  ListingService,
  MerchantRepository,
  VariantRepository,
  VariantService,
  runSqliteMigrations,
  type Connection,
  type Listing,
  type ListingMode,
  type Variant,
} from "@smb-os/db";
import type { PublicListing, PublicMerchantProfile, PublicProductDetail, PublicVariant } from "@smb-os/contracts";
import { SlidingWindowRateLimiter } from "../auth/rateLimiter.js";
import { problemType, sendProblem } from "../problemDetails.js";

const LISTING_MODES: readonly ListingMode[] = ["PRODUCT", "SERVICE", "RENTAL"];

interface PublicStorefrontServices {
  merchants: MerchantRepository;
  listings: ListingService;
  variants: VariantService;
  movements: InventoryMovementRepository;
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

  app.get<{ Params: { slug: string }; Querystring: { mode?: string } }>(
    "/v1/m/:slug/listings",
    async (request, reply) => {
      if (!limiter.consume(`ip:${request.ip}`)) {
        return sendProblem(request, reply, 429, problemType("rate-limited"), "Too Many Requests", "Too many requests. Try again later.");
      }

      const { mode } = request.query;
      if (mode !== undefined && !LISTING_MODES.includes(mode as ListingMode)) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "mode must be PRODUCT, SERVICE, or RENTAL.");
      }

      const { merchants, listings } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
      }

      const ctx = createTenantContext(merchant.id);
      const published = listings
        .listPublished(ctx)
        .filter((listing) => mode === undefined || listing.mode === mode)
        .map(toPublicListing);
      return reply.code(200).send(published);
    },
  );

  /**
   * `docs/cards/D122.md`'s product detail page — this route is
   * deliberately PRODUCT-only (the card's scope); a SERVICE/RENTAL
   * listing's slug 404s here exactly like an unknown one, no different
   * response shape that would confirm it exists under a mode this route
   * doesn't yet serve. Same unauthenticated + rate-limited + `PUBLISHED`-
   * only posture as the two routes above.
   */
  app.get<{ Params: { slug: string; listingSlug: string } }>(
    "/v1/m/:slug/listings/:listingSlug",
    async (request, reply) => {
      if (!limiter.consume(`ip:${request.ip}`)) {
        return sendProblem(request, reply, 429, problemType("rate-limited"), "Too Many Requests", "Too many requests. Try again later.");
      }

      const { merchants, listings, variants, movements } = await getServices();
      const merchant = merchants.findBySlug(request.params.slug);
      if (!merchant) {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No merchant with that slug.");
      }

      const ctx = createTenantContext(merchant.id);
      const listing = listings.findPublishedBySlug(ctx, request.params.listingSlug);
      if (!listing || listing.mode !== "PRODUCT") {
        return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No listing with that slug.");
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
}
