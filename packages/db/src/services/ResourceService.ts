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
}
