import { eq } from "drizzle-orm";
import type { Connection } from "../../../connection.js";
import { locations } from "../../../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../../TenantScopedRepository.js";

/**
 * Fixture for `isolation-coverage.test.ts` — every method here has a
 * matching isolation test in `GoodFixtureRepository.test.ts`, so the
 * generator should report zero gaps for this file.
 */
export class GoodFixtureRepository extends TenantScopedRepository<typeof locations.merchantId> {
  constructor(private readonly conn: Connection) {
    super(locations.merchantId);
  }

  findById: RepositoryMethod<[id: string], unknown> = (ctx, id) => {
    return this.conn.db
      .select()
      .from(locations)
      .where(eq(locations.id, id))
      .get();
  };
}
