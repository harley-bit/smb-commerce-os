import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `docs/design/04`: migrations are forward-only — no down migrations in
 * production, a bad migration is fixed by a new migration. drizzle-kit
 * itself never generates a down file, but nothing stops one being added
 * by hand later, so this guards the policy directly rather than trusting
 * the tool's default behaviour to hold forever.
 */
describe("forward-only migration policy", () => {
  for (const dialect of ["sqlite", "pg"] as const) {
    it(`${dialect}: no down/rollback migration files exist`, () => {
      const folder = fileURLToPath(
        new URL(`../migrations/${dialect}`, import.meta.url),
      );
      const files = readdirSync(folder, { recursive: true }) as string[];

      const downFiles = files.filter((file) =>
        /down|rollback|revert/i.test(file),
      );

      expect(downFiles).toEqual([]);
    });

    it(`${dialect}: journal only ever appends entries (idx is 0..n-1 in order)`, () => {
      const journalPath = fileURLToPath(
        new URL(`../migrations/${dialect}/meta/_journal.json`, import.meta.url),
      );
      const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
        entries: { idx: number }[];
      };

      const indexes = journal.entries.map((entry) => entry.idx);
      expect(indexes).toEqual(indexes.map((_, i) => i));
    });
  }
});
