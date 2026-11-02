import { Money, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import { assertCanManageCatalog } from "./ListingService.js";
import type {
  CreateVariantInput,
  UpdateVariantInput,
  Variant,
  VariantMode,
  VariantRepository,
} from "../repositories/VariantRepository.js";

export type { CreateVariantInput };

/**
 * `docs/design/03`'s `listing_variants_mode_fields_check` (`D022`/`D063`),
 * mirrored here so a caller gets a clear application error before the write
 * ever reaches the DB CHECK constraint: `durationMinutes` is services-only,
 * `ratePeriod`/`depositMinor`/`bufferMinutes` are rentals-only.
 */
const FORBIDDEN_FIELDS_BY_MODE: Record<VariantMode, readonly string[]> = {
  PRODUCT: ["durationMinutes", "ratePeriod", "depositMinor", "bufferMinutes"],
  SERVICE: ["ratePeriod", "depositMinor", "bufferMinutes"],
  RENTAL: ["durationMinutes"],
};

function assertFieldsAllowedForMode(mode: VariantMode, input: Record<string, unknown>): void {
  for (const field of FORBIDDEN_FIELDS_BY_MODE[mode]) {
    if (input[field] !== undefined) {
      throw new Error(`${mode} variants cannot carry field forbidden by mode: ${field}`);
    }
  }
}

/**
 * This card's security check: variant price is server-authoritative. Every
 * `priceMinor`/`currency` pair a caller supplies — on create and on update —
 * is validated through `Money.of()` (`packages/domain`) before it is ever
 * persisted: non-integer minor units and empty currency codes are rejected
 * here, not trusted from a raw payload. No endpoint in this service accepts
 * a pre-computed total; the stored `priceMinor` is always what this
 * validation let through.
 */
function assertValidPrice(priceMinor: number, currency: string): void {
  Money.of(priceMinor, currency);
}

/**
 * The service layer for `listing_variants`: create/update/archive with
 * mode-conditional field validation and price validation, per this card's
 * deliverable. `assertCanManageCatalog` (`./ListingService.js`) runs first
 * in every mutating method, before field/price validation and before the
 * repository ever runs — same authorization posture as `ListingService` and
 * `ProductListingService`.
 */
export class VariantService {
  constructor(private readonly repo: VariantRepository) {}

  create(ctx: TenantContext, actingRole: MerchantUserRole, input: CreateVariantInput): string {
    assertCanManageCatalog(actingRole);
    assertFieldsAllowedForMode(input.mode, input as unknown as Record<string, unknown>);
    assertValidPrice(input.priceMinor, input.currency);
    return this.repo.create(ctx, input);
  }

  update(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    id: string,
    patch: UpdateVariantInput,
  ): void {
    assertCanManageCatalog(actingRole);
    const existing = this.repo.findById(ctx, id);
    if (existing) {
      assertFieldsAllowedForMode(existing.mode, patch as unknown as Record<string, unknown>);
      if (patch.priceMinor !== undefined) {
        assertValidPrice(patch.priceMinor, patch.currency ?? existing.currency);
      }
    }
    this.repo.update(ctx, id, patch);
  }

  archive(ctx: TenantContext, actingRole: MerchantUserRole, id: string, archivedAt: string): void {
    assertCanManageCatalog(actingRole);
    this.repo.archive(ctx, id, archivedAt);
  }

  listByListing(ctx: TenantContext, listingId: string): Variant[] {
    return this.repo.listByListing(ctx, listingId);
  }

  findById(ctx: TenantContext, id: string): Variant | undefined {
    return this.repo.findById(ctx, id);
  }
}
