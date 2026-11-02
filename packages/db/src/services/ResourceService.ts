import type { TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import { assertCanManageCatalog } from "./ListingService.js";
import type {
  AvailabilityException,
  AvailabilityExceptionRepository,
  CreateAvailabilityExceptionInput,
  UpdateAvailabilityExceptionInput,
} from "../repositories/AvailabilityExceptionRepository.js";
import type {
  AvailabilityRule,
  AvailabilityRuleRepository,
  CreateAvailabilityRuleInput,
  UpdateAvailabilityRuleInput,
} from "../repositories/AvailabilityRuleRepository.js";
import type {
  CreateResourceInput,
  Resource,
  ResourceRepository,
  UpdateResourceInput,
} from "../repositories/ResourceRepository.js";
import type {
  AssignListingResourceInput,
  ListingResourceAssignment,
  ListingResourceRepository,
} from "../repositories/ListingResourceRepository.js";
import type { ListingRepository } from "../repositories/ListingRepository.js";

/**
 * `docs/cards/D107.md` security check — "resource assignment respects
 * tenant scope." Thrown when either side of an assignment doesn't resolve
 * under the acting tenant's own `ctx` — `ListingRepository.findById`/
 * `ResourceRepository.findById` both already return `undefined` for a
 * cross-tenant id (their own tenant-scoping predicate), so this is a
 * belt-and-suspenders application error surfaced before
 * `ListingResourceRepository.assign` ever runs, not a second scoping
 * mechanism.
 */
export class CrossTenantResourceAssignmentError extends Error {
  constructor() {
    super("Listing and resource must both belong to the acting tenant.");
    this.name = "CrossTenantResourceAssignmentError";
  }
}

/**
 * `docs/design/03` "Service capacity" is a catalog concept — a resource is
 * what a `SERVICE`/`RENTAL` listing is fulfilled by — so this card's
 * authorization posture reuses `assertCanManageCatalog` (`ListingService.js`)
 * rather than inventing a second role rule: OWNER/ADMIN can manage
 * resources, availability rules, and exceptions; STAFF/READ_ONLY cannot.
 * This is this card's authorization acceptance criterion made real, and
 * doubles as the security check answer — a `STAFF`-kind resource carries a
 * staff member's name (`docs/design/08` "Merchant staff" → Confidential),
 * so the same gate that protects catalog writes also protects the one
 * place personal data enters this table. Reads are unrestricted by role,
 * same posture as `ListingService.list`/`findById`.
 */
export class ResourceService {
  constructor(
    private readonly resources: ResourceRepository,
    private readonly rules: AvailabilityRuleRepository,
    private readonly exceptions: AvailabilityExceptionRepository,
    private readonly listingResources: ListingResourceRepository,
    private readonly listings: ListingRepository,
  ) {}

  createResource(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: CreateResourceInput,
  ): string {
    assertCanManageCatalog(actingRole);
    return this.resources.create(ctx, input);
  }

  updateResource(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    id: string,
    patch: UpdateResourceInput,
  ): void {
    assertCanManageCatalog(actingRole);
    this.resources.update(ctx, id, patch);
  }

  archiveResource(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    id: string,
    archivedAt: string,
  ): void {
    assertCanManageCatalog(actingRole);
    this.resources.archive(ctx, id, archivedAt);
  }

  listResources(ctx: TenantContext): Resource[] {
    return this.resources.list(ctx);
  }

  findResourceById(ctx: TenantContext, id: string): Resource | undefined {
    return this.resources.findById(ctx, id);
  }

  createAvailabilityRule(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: CreateAvailabilityRuleInput,
  ): string {
    assertCanManageCatalog(actingRole);
    return this.rules.create(ctx, input);
  }

  updateAvailabilityRule(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    id: string,
    patch: UpdateAvailabilityRuleInput,
  ): void {
    assertCanManageCatalog(actingRole);
    this.rules.update(ctx, id, patch);
  }

  removeAvailabilityRule(ctx: TenantContext, actingRole: MerchantUserRole, id: string): void {
    assertCanManageCatalog(actingRole);
    this.rules.remove(ctx, id);
  }

  listAvailabilityRules(ctx: TenantContext, resourceId: string): AvailabilityRule[] {
    return this.rules.listByResource(ctx, resourceId);
  }

  createAvailabilityException(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: CreateAvailabilityExceptionInput,
  ): string {
    assertCanManageCatalog(actingRole);
    return this.exceptions.create(ctx, input);
  }

  updateAvailabilityException(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    id: string,
    patch: UpdateAvailabilityExceptionInput,
  ): void {
    assertCanManageCatalog(actingRole);
    this.exceptions.update(ctx, id, patch);
  }

  removeAvailabilityException(ctx: TenantContext, actingRole: MerchantUserRole, id: string): void {
    assertCanManageCatalog(actingRole);
    this.exceptions.remove(ctx, id);
  }

  listAvailabilityExceptions(ctx: TenantContext, resourceId: string): AvailabilityException[] {
    return this.exceptions.listByResource(ctx, resourceId);
  }

  /**
   * `docs/cards/D107.md` deliverable — "SERVICE listings: ... resources."
   * Security check: "resource assignment respects tenant scope." Both
   * `listingId` and `resourceId` are re-resolved through their own
   * tenant-scoped `findById` under the *acting* `ctx` before the join row is
   * ever written — a caller cannot link a listing it doesn't own to a
   * resource it doesn't own (or vice versa) by supplying ids from another
   * merchant, even if `ListingResourceRepository.assign` itself would
   * otherwise happily record the row under the acting tenant's own
   * `merchantId`. This is why the check lives here and not only in the
   * repository: the repository's `merchantId` guarantee alone can't tell
   * whether the *referenced* listing/resource ids belong to that tenant.
   */
  assignListingResource(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: AssignListingResourceInput,
  ): string {
    assertCanManageCatalog(actingRole);
    const listing = this.listings.findById(ctx, input.listingId);
    const resource = this.resources.findById(ctx, input.resourceId);
    if (!listing || !resource) {
      throw new CrossTenantResourceAssignmentError();
    }
    return this.listingResources.assign(ctx, input);
  }

  removeListingResource(ctx: TenantContext, actingRole: MerchantUserRole, id: string): void {
    assertCanManageCatalog(actingRole);
    this.listingResources.remove(ctx, id);
  }

  listListingResources(ctx: TenantContext, listingId: string): ListingResourceAssignment[] {
    return this.listingResources.listByListing(ctx, listingId);
  }
}
