import type { TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type {
  CreateListingInput,
  Listing,
  ListingMode,
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

  /**
   * `docs/cards/D122.md`'s listing detail page: a storefront visitor
   * navigates by `slug`, never by DB-internal `id` (same posture as
   * `MerchantRepository.findBySlug`). Only ever returns a `PUBLISHED`
   * listing, same as `listPublished` — a draft/archived listing's slug
   * must 404 exactly like an unknown one.
   */
  findPublishedBySlug(ctx: TenantContext, slug: string): Listing | undefined {
    return this.repo.list(ctx).find((listing) => listing.status === "PUBLISHED" && listing.slug === slug);
  }

  findById(ctx: TenantContext, id: string): Listing | undefined {
    return this.repo.findById(ctx, id);
  }

  /**
   * `docs/cards/D141.md`'s cursor-based catalog browse: `cursor` is the
   * `id` of the last listing the caller has already seen (`undefined` for
   * the first page), never a numeric offset/page index — there is no
   * offset concept anywhere in this method's signature or return value,
   * which is this card's security check answered by construction: a
   * caller can only walk the catalog forward one page at a time from
   * where it last left off, never jump to an arbitrary position or infer
   * the total catalog size from an offset. Listings are sorted by their
   * own `id` (a UUIDv7, monotonically increasing with creation time) so
   * the order is stable across calls even as new listings are published
   * concurrently. An unrecognized/stale cursor (e.g. the referenced
   * listing was archived since) fails open to the first page rather than
   * throwing or returning nothing.
   */
  listPublishedPage(
    ctx: TenantContext,
    options: { mode?: ListingMode; cursor?: string; limit: number },
  ): { items: Listing[]; nextCursor: string | null } {
    const filtered = this.listPublished(ctx)
      .filter((listing) => options.mode === undefined || listing.mode === options.mode)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const cursorIndex = options.cursor === undefined ? -1 : filtered.findIndex((listing) => listing.id === options.cursor);
    const start = cursorIndex + 1;

    const items = filtered.slice(start, start + options.limit);
    const lastItem = items.at(-1);
    const nextCursor = lastItem !== undefined && start + items.length < filtered.length ? lastItem.id : null;
    return { items, nextCursor };
  }
}
