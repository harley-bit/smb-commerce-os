import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import rule from "../rules/no-raw-sql.js";

describe("local/no-raw-sql", () => {
  it("flags raw SQL literals, tagged templates, and .query() calls; allows the drizzle query builder", () => {
    const ruleTester = new RuleTester({
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    });

    ruleTester.run("no-raw-sql", rule, {
      valid: [
        // The vetted query builder — no raw SQL string anywhere.
        `db.select().from(bookings).where(eq(bookings.tenantId, tenantId));`,
        // A plain non-SQL string is fine.
        `const greeting = "hello there";`,
        // Passing a variable (not a literal) to .query() can't be statically judged as raw SQL.
        `client.query(preparedStatement);`,
      ],
      invalid: [
        {
          code: `const q = "SELECT * FROM bookings WHERE tenant_id = 1";`,
          errors: [{ messageId: "rawSqlLiteral" }],
        },
        {
          code: "const q = `DELETE FROM bookings WHERE id = ${id}`;",
          errors: [{ messageId: "rawSqlLiteral" }],
        },
        {
          code: "const rows = sql`SELECT * FROM bookings`;",
          errors: [{ messageId: "rawSqlTag" }, { messageId: "rawSqlLiteral" }],
        },
        {
          code: `client.query("SELECT * FROM bookings");`,
          errors: [{ messageId: "rawSqlCall" }, { messageId: "rawSqlLiteral" }],
        },
      ],
    });
  });
});
