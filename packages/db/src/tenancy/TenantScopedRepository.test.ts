import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createConnection } from "../connection.js";
import { TenantScopedRepository } from "./TenantScopedRepository.js";

const widgets = sqliteTable("widgets", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  value: integer("value").notNull(),
});

class WidgetRepository extends TenantScopedRepository<typeof widgets.merchantId> {
  constructor(private readonly conn: ReturnType<typeof createConnection>) {
    super(widgets.merchantId);
  }

  findAll(ctx: import("@smb-os/domain").TenantContext): { id: string; value: number }[] {
    return this.conn.db.select().from(widgets).where(this.scope(ctx)).all();
  }
}

function seededRepo(): { repo: WidgetRepository; merchantA: string; merchantB: string } {
  const conn = createConnection(":memory:");
  conn.sqlite.exec(
    "CREATE TABLE widgets (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, value INTEGER NOT NULL)"
  );
  const merchantA = generateUuidV7();
  const merchantB = generateUuidV7();
  conn.sqlite
    .prepare("INSERT INTO widgets (id, merchant_id, value) VALUES (?, ?, ?)")
    .run(generateUuidV7(), merchantA, 1);
  conn.sqlite
    .prepare("INSERT INTO widgets (id, merchant_id, value) VALUES (?, ?, ?)")
    .run(generateUuidV7(), merchantB, 2);
  return { repo: new WidgetRepository(conn), merchantA, merchantB };
}

describe("TenantScopedRepository (runtime layer)", () => {
  it("scope() limits results to the calling merchant only", () => {
    const { repo, merchantA } = seededRepo();
    const rows = repo.findAll(createTenantContext(merchantA));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(1);
  });

  it("never leaks another merchant's rows", () => {
    const { repo, merchantA, merchantB } = seededRepo();
    const rowsA = repo.findAll(createTenantContext(merchantA));
    const rowsB = repo.findAll(createTenantContext(merchantB));
    expect(rowsA.map((r) => r.value)).toEqual([1]);
    expect(rowsB.map((r) => r.value)).toEqual([2]);
  });
});

/**
 * Compile-time layer proof: `docs/design/07` Control #1 requires every
 * repository method to take `TenantContext` as its first parameter, "a
 * missing scope is a compile error." Verified here against real tsc
 * diagnostics on the actual `RepositoryMethod` type, not a re-declared
 * copy — same pattern as `packages/config/test/strict-config.test.ts`.
 */
describe("RepositoryMethod (type-system layer)", () => {
  const dbTsconfigPath = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));
  const tenancyDir = fileURLToPath(new URL(".", import.meta.url));

  function diagnosticCodesFor(source: string): number[] {
    const fixturePath = join(tenancyDir, `.fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
    writeFileSync(fixturePath, source);

    try {
      const configFile = ts.readConfigFile(dbTsconfigPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(dbTsconfigPath));
      const program = ts.createProgram([fixturePath], {
        ...parsed.options,
        noEmit: true,
        composite: false,
        declaration: false,
        declarationMap: false,
      });
      return ts
        .getPreEmitDiagnostics(program)
        .filter((d) => d.file?.fileName === fixturePath)
        .map((d) => d.code);
    } finally {
      rmSync(fixturePath, { force: true });
    }
  }

  it("rejects a repository method missing TenantContext as its first parameter", () => {
    const codes = diagnosticCodesFor(`
      import type { RepositoryMethod } from "./TenantScopedRepository.js";

      interface WidgetRepository {
        findById: RepositoryMethod<[id: string], string | undefined>;
      }

      export const bad: WidgetRepository = {
        findById: (id: string) => id,
      };
    `);
    expect(codes.length).toBeGreaterThan(0);
  });

  it("accepts the same method with TenantContext as its first parameter", () => {
    const codes = diagnosticCodesFor(`
      import type { TenantContext } from "@smb-os/domain";
      import type { RepositoryMethod } from "./TenantScopedRepository.js";

      interface WidgetRepository {
        findById: RepositoryMethod<[id: string], string | undefined>;
      }

      export const good: WidgetRepository = {
        findById: (_ctx: TenantContext, id: string) => id,
      };
    `);
    expect(codes).toEqual([]);
  });
});

