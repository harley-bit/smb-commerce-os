import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { listings } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type ListingMode = "PRODUCT" | "SERVICE" | "RENTAL";
export type ListingStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface Listing {
  id: string;
  merchantId: string;
  mode: ListingMode;
  name: string;
  slug: string;
  description: string | null;
  status: ListingStatus;
  createdAt: string;
  archivedAt: string | null;
}

export interface CreateListingInput {
  mode: ListingMode;
  name: string;
  slug: string;
  description?: string;
  status: ListingStatus;
  createdAt: string;
}

/**
 * Deliberately has no `mode` field — `docs/design/03`: "`mode` is immutable
 * after creation." This type is the compile-time half of that guarantee;
 * `ListingService.update` (`../services/ListingService.ts`) adds the
 * runtime half, since a caller can still hand this repository a plain
 * object with an extra `mode` key that bypasses the type check.
 */
export interface UpdateListingInput {
  name?: string;
  slug?: string;
  description?: string;
  status?: ListingStatus;
}

/**
 * `listings.merchant_id` scopes every query, per `docs/design/07`
 * Control #1. `mode` immutability is not this repository's job — see
 * `UpdateListingInput`'s comment and `ListingService`.
 */
export class ListingRepository extends TenantScopedRepository<typeof listings.merchantId> {
  constructor(private readonly conn: Connection) {
    super(listings.merchantId);
  }

  create: RepositoryMethod<[input: CreateListingInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(listings)
      .values({ id, merchantId: ctx.merchantId, ...input })
      .run();
    return id;
  };

  list: RepositoryMethod<[], Listing[]> = (ctx) => {
    return this.conn.db
      .select()
      .from(listings)
      .where(this.scope(ctx))
      .all() as Listing[];
  };

  findById: RepositoryMethod<[id: string], Listing | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(listings)
      .where(and(this.scope(ctx), eq(listings.id, id)))
      .get() as Listing | undefined;
  };

  update: RepositoryMethod<[id: string, patch: UpdateListingInput], void> = (ctx, id, patch) => {
    this.conn.db
      .update(listings)
      .set(patch)
      .where(and(this.scope(ctx), eq(listings.id, id)))
      .run();
  };

  archive: RepositoryMethod<[id: string, archivedAt: string], void> = (ctx, id, archivedAt) => {
    this.conn.db
      .update(listings)
      .set({ archivedAt })
      .where(and(this.scope(ctx), eq(listings.id, id)))
      .run();
  };
}
