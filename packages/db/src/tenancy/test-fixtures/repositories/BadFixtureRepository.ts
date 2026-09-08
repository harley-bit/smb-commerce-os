import { eq } from "drizzle-orm";
import type { Connection } from "../../../connection.js";
import { locations } from "../../../schema/sqlite.js";
import { TenantScopedRepository, type RepositoryMethod } from "../../TenantScopedRepository.js";

/**
 * Fixture for `isolation-coverage.test.ts` — simulates a new repository
 * method (`archive`) landing without a corresponding cross-tenant
 * isolation test, so the generator must report exactly this gap. This is
 * card D021's acceptance criterion: a new method with no isolation test
 * fails the build.
 */
export class BadFixtureRepository extends TenantScopedRepository<typeof locations.merchantId> {
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

  // Deliberately untested (below), and its single test-file mention only
  // ever uses one tenant context — no isolation evidence.
  archive: RepositoryMethod<[id: string], void> = (ctx, id) => {
    this.conn.db.update(locations).set({ archivedAt: "now" }).where(eq(locations.id, id)).run();
  };
}
