import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { listingResources } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export interface ListingResourceAssignment {
  id: string;
  merchantId: string;
  listingId: string;
  resourceId: string;
  createdAt: string;
}

export interface AssignListingResourceInput {
  listingId: string;
  resourceId: string;
  createdAt: string;
}

/**
 * `listing_resources.merchant_id` scopes every query, same posture as
 * `ResourceRepository` — this is the join `docs/design/03` describes
 * ("which resources can fulfil a service") and `D058`/`D059`'s logs flagged
 * as missing. `assign` sets `merchantId` from `ctx.merchantId` rather than
 * trusting the input, so a caller cannot link a listing in one tenant to a
 * resource in another by supplying ids alone — this repository only ever
 * writes/reads rows scoped to the acting tenant; it does not itself verify
 * that `listingId`/`resourceId` actually belong to that tenant (the service
 * layer does that, `ListingResourceRepository`'s counterpart in
 * `../services/ResourceService.ts`, this card's security check).
 */
export class ListingResourceRepository extends TenantScopedRepository<typeof listingResources.merchantId> {
  constructor(private readonly conn: Connection) {
    super(listingResources.merchantId);
  }

  assign: RepositoryMethod<[input: AssignListingResourceInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(listingResources)
      .values({ id, merchantId: ctx.merchantId, ...input })
      .run();
    return id;
  };

  listByListing: RepositoryMethod<[listingId: string], ListingResourceAssignment[]> = (ctx, listingId) => {
    return this.conn.db
      .select()
      .from(listingResources)
      .where(and(this.scope(ctx), eq(listingResources.listingId, listingId)))
      .all() as ListingResourceAssignment[];
  };

  remove: RepositoryMethod<[id: string], void> = (ctx, id) => {
    this.conn.db
      .delete(listingResources)
      .where(and(this.scope(ctx), eq(listingResources.id, id)))
      .run();
  };
}
