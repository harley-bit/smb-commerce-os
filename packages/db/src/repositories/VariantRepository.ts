import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { listingVariants } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export type VariantMode = "PRODUCT" | "SERVICE" | "RENTAL";
export type VariantRatePeriod = "HOUR" | "DAY" | "WEEK";

export interface Variant {
  id: string;
  merchantId: string;
  listingId: string;
  mode: VariantMode;
  sku: string;
  name: string;
  attributesJson: string | null;
  priceMinor: number;
  currency: string;
  durationMinutes: number | null;
  ratePeriod: VariantRatePeriod | null;
  depositMinor: number | null;
  bufferMinutes: number | null;
  archivedAt: string | null;
}

export interface CreateVariantInput {
  listingId: string;
  mode: VariantMode;
  sku: string;
  name: string;
  attributesJson?: string;
  priceMinor: number;
  currency: string;
  durationMinutes?: number;
  ratePeriod?: VariantRatePeriod;
  depositMinor?: number;
  bufferMinutes?: number;
}

/**
 * Deliberately has no `mode`/`listingId` fields — a variant's mode and
 * parent listing are fixed at creation, same posture as `mode` immunity on
 * `listings` itself (`docs/design/03`).
 */
export interface UpdateVariantInput {
  sku?: string;
  name?: string;
  attributesJson?: string;
  priceMinor?: number;
  currency?: string;
  durationMinutes?: number;
  ratePeriod?: VariantRatePeriod;
  depositMinor?: number;
  bufferMinutes?: number;
}

/**
 * `listing_variants.merchant_id` scopes every query, per `docs/design/07`
 * Control #1. The DB-level `listing_variants_mode_fields_check` CHECK
 * constraint (`D022`) rejects any row carrying a field forbidden by its
 * mode regardless of what this repository is handed — the service layer
 * (`../services/VariantService.ts`) adds the same check earlier, so a
 * caller sees a clear application error instead of a raw constraint
 * violation, but the DB constraint is the actual enforcement floor.
 */
export class VariantRepository extends TenantScopedRepository<typeof listingVariants.merchantId> {
  constructor(private readonly conn: Connection) {
    super(listingVariants.merchantId);
  }

  create: RepositoryMethod<[input: CreateVariantInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(listingVariants)
      .values({ id, merchantId: ctx.merchantId, ...input })
      .run();
    return id;
  };

  listByListing: RepositoryMethod<[listingId: string], Variant[]> = (ctx, listingId) => {
    return this.conn.db
      .select()
      .from(listingVariants)
      .where(and(this.scope(ctx), eq(listingVariants.listingId, listingId)))
      .all() as Variant[];
  };

  findById: RepositoryMethod<[id: string], Variant | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(listingVariants)
      .where(and(this.scope(ctx), eq(listingVariants.id, id)))
      .get() as Variant | undefined;
  };

  update: RepositoryMethod<[id: string, patch: UpdateVariantInput], void> = (ctx, id, patch) => {
    this.conn.db
      .update(listingVariants)
      .set(patch)
      .where(and(this.scope(ctx), eq(listingVariants.id, id)))
      .run();
  };

  archive: RepositoryMethod<[id: string, archivedAt: string], void> = (ctx, id, archivedAt) => {
    this.conn.db
      .update(listingVariants)
      .set({ archivedAt })
      .where(and(this.scope(ctx), eq(listingVariants.id, id)))
      .run();
  };
}
