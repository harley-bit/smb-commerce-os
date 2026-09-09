import type { TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type {
  CreateListingInput,
  Listing,
  ListingRepository,
  UpdateListingInput,
} from "../repositories/ListingRepository.js";

/**
 * `docs/design/07`: "permission checks are a single `assertCan(ctx, action,
 * resource) call at the top of each service method`" — catalog management
 * (create/update/archive) is an `ADMIN`-level "Operations" action per that
 * doc's role table; `STAFF`/`READ_ONLY` are denied. This is this card's
 * security check, answered directly: the assertion lives here, in the
 * service, not in a controller/route — a controller only ever calls
 * `ListingService`, never `ListingRepository` directly.
 */
export function assertCanManageCatalog(actingRole: MerchantUserRole): void {
  if (actingRole !== "OWNER" && actingRole !== "ADMIN") {
    throw new Error(
      `Catalog management is restricted to OWNER or ADMIN, got acting role: ${actingRole}`,
    );
  }
}

/**
 * `docs/design/03`: "`mode` is immutable after creation. Changing a
 * listing's mode changes which capacity strategy governs it and invalidates
 * existing reservations." `UpdateListingInput` already omits `mode` at the
 * type level, but a caller (eventually a controller deserializing a client
 * payload) can still hand this a plain object carrying an extra `mode` key
 * that bypasses that compile-time guarantee — this runtime check is the
 * card's acceptance criterion made real.
 */
function assertModeUnchanged(patch: UpdateListingInput): void {
  if ("mode" in patch) {
    throw new Error("Listing mode is immutable after creation and cannot be changed via update.");
  }
}

/**
 * The service layer for `listings`: create/update/archive with mode
 * validation, per this card's deliverable. Wraps `ListingRepository`
 * rather than replacing it — tenant scoping still happens there
 * (`docs/design/07` Control #1); this layer adds authorization and the
 * mode-immutability guard the repository/DB layer can't enforce alone.
 */
export class ListingService {
  constructor(private readonly repo: ListingRepository) {}

  create(ctx: TenantContext, actingRole: MerchantUserRole, input: CreateListingInput): string {
    assertCanManageCatalog(actingRole);
    return this.repo.create(ctx, input);
  }

  update(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    id: string,
    patch: UpdateListingInput,
  ): void {
    assertCanManageCatalog(actingRole);
    assertModeUnchanged(patch);
    this.repo.update(ctx, id, patch);
  }

  archive(ctx: TenantContext, actingRole: MerchantUserRole, id: string, archivedAt: string): void {
    assertCanManageCatalog(actingRole);
    this.repo.archive(ctx, id, archivedAt);
  }

  list(ctx: TenantContext): Listing[] {
    return this.repo.list(ctx);
  }

  /**
   * D121's storefront read: unlike `list()`, no `MerchantUserRole` is
   * accepted here — a storefront visitor has no merchant membership, and
   * only `PUBLISHED` listings are ever visible to one, across all three
   * modes on one page (this card's acceptance criterion). Draft and
   * archived listings never reach this method's caller.
   */
  listPublished(ctx: TenantContext): Listing[] {
    return this.repo.list(ctx).filter((listing) => listing.status === "PUBLISHED");
  }

  findById(ctx: TenantContext, id: string): Listing | undefined {
    return this.repo.findById(ctx, id);
  }
}
