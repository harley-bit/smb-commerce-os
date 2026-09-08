import type { TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { Listing, ListingStatus, UpdateListingInput } from "../repositories/ListingRepository.js";
import { assertCanManageCatalog, type ListingService } from "./ListingService.js";

export interface CreateProductListingInput {
  name: string;
  slug: string;
  description?: string;
  status: ListingStatus;
  createdAt: string;
}

/**
 * `docs/design/03`: `duration_minutes` is services-only, `rate_period` and
 * `deposit_minor` are rentals-only. The `listings` table itself has no such
 * columns — they live on `listing_variants` (`D033`'s job) — but a client
 * payload is untyped JSON before it reaches this service, so a caller can
 * still hand a PRODUCT-listing call an object carrying those keys. This
 * card's acceptance criterion ("mode-specific validation rejects
 * service/rental fields") is enforced here, at the boundary, before D033's
 * variant layer exists to enforce it via the DB CHECK constraint.
 */
const SERVICE_OR_RENTAL_ONLY_FIELDS = ["durationMinutes", "ratePeriod", "depositMinor"] as const;

function assertNoServiceOrRentalFields(input: Record<string, unknown>): void {
  for (const field of SERVICE_OR_RENTAL_ONLY_FIELDS) {
    if (field in input) {
      throw new Error(`PRODUCT listings cannot carry service/rental-only field: ${field}`);
    }
  }
}

/**
 * A PRODUCT-mode-locked facade over `ListingService`. `create` never trusts
 * a caller-supplied `mode` — it is hardcoded to `"PRODUCT"` regardless of
 * what a raw payload contains, the same "don't trust the client" posture
 * `CLAUDE.md` requires for prices/totals. This card's security check
 * ("authorization asserted before any write"): `assertCanManageCatalog`
 * runs first in both `create` and `update`, before field validation and
 * before `ListingService`/the repository ever run — an unauthorized caller
 * is rejected without either the field check or a write happening.
 */
export class ProductListingService {
  constructor(private readonly listingService: ListingService) {}

  create(ctx: TenantContext, actingRole: MerchantUserRole, input: CreateProductListingInput): string {
    assertCanManageCatalog(actingRole);
    assertNoServiceOrRentalFields(input as unknown as Record<string, unknown>);
    return this.listingService.create(ctx, actingRole, { ...input, mode: "PRODUCT" });
  }

  update(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    id: string,
    patch: UpdateListingInput,
  ): void {
    assertCanManageCatalog(actingRole);
    assertNoServiceOrRentalFields(patch as unknown as Record<string, unknown>);
    this.listingService.update(ctx, actingRole, id, patch);
  }

  archive(ctx: TenantContext, actingRole: MerchantUserRole, id: string, archivedAt: string): void {
    this.listingService.archive(ctx, actingRole, id, archivedAt);
  }

  findById(ctx: TenantContext, id: string): Listing | undefined {
    return this.listingService.findById(ctx, id);
  }
}
