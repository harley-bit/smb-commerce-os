import { generateUuidV7 } from "@smb-os/domain";
import { and, eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { locations } from "../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../tenancy/TenantScopedRepository.js";

export interface Location {
  id: string;
  merchantId: string;
  name: string;
  timezone: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  archivedAt: string | null;
}

export interface CreateLocationInput {
  name: string;
  timezone: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface UpdateLocationInput {
  name?: string;
  timezone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/**
 * `locations.merchant_id` scopes every query — `create` sets it from
 * `ctx.merchantId` rather than trusting the input, and every other method
 * ANDs `this.scope(ctx)` with the row's own id so a caller can never
 * read, update, or archive another merchant's location
 * (`docs/design/07` Control #1, runtime layer).
 */
export class LocationRepository extends TenantScopedRepository<typeof locations.merchantId> {
  constructor(private readonly conn: Connection) {
    super(locations.merchantId);
  }

  create: RepositoryMethod<[input: CreateLocationInput], string> = (ctx, input) => {
    const id = generateUuidV7();
    this.conn.db
      .insert(locations)
      .values({ id, merchantId: ctx.merchantId, ...input })
      .run();
    return id;
  };

  list: RepositoryMethod<[], Location[]> = (ctx) => {
    return this.conn.db
      .select()
      .from(locations)
      .where(this.scope(ctx))
      .all() as Location[];
  };

  findById: RepositoryMethod<[id: string], Location | undefined> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(locations)
      .where(and(this.scope(ctx), eq(locations.id, id)))
      .get() as Location | undefined;
  };

  update: RepositoryMethod<[id: string, patch: UpdateLocationInput], void> = (ctx, id, patch) => {
    this.conn.db
      .update(locations)
      .set(patch)
      .where(and(this.scope(ctx), eq(locations.id, id)))
      .run();
  };

  archive: RepositoryMethod<[id: string, archivedAt: string], void> = (ctx, id, archivedAt) => {
    this.conn.db
      .update(locations)
      .set({ archivedAt })
      .where(and(this.scope(ctx), eq(locations.id, id)))
      .run();
  };
}
