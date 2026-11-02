import { createConnection, runSqliteMigrations } from "@smb-os/db";
import { buildApp } from "./app.js";
import { DbMerchantMembershipResolver } from "./auth/authenticate.js";

/**
 * `docs/cards/D136.md` — the first real, listening process for `apps/api`.
 * Every prior card exercised `buildApp()` only through `app.inject()` in
 * tests (`apps/api/test/**`); nothing ever started a live server against a
 * real, shared connection (`app.ts`'s own doc comment on `connection?:
 * Connection` called this out explicitly: "Real end-to-end DB wiring for
 * `apps/api` is still a future card"). Playwright's E2E suite (`e2e/`)
 * needs an actual HTTP server to drive a real browser against, so this is
 * that future card's minimal, honest answer: one shared SQLite connection,
 * migrated once at boot, wired into both the tenant-scoped catalog routes
 * and the membership resolver the auth middleware checks — the specific
 * disconnect `app.ts`'s comment flagged as the reason a from-scratch
 * default `buildApp()` could never resolve a real membership.
 *
 * Not a production deployment entrypoint (no PG connection support, no
 * graceful shutdown beyond SIGTERM/SIGINT, no clustering) — just enough to
 * run locally and in CI for E2E and manual smoke-testing.
 */
async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3001);
  const dbFile = process.env.DB_FILE ?? ":memory:";
  const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? webBaseUrl).split(",").map((origin) => origin.trim());

  const connection = createConnection(dbFile);
  await runSqliteMigrations(connection);

  const app = buildApp({
    connection,
    merchantMembershipResolver: new DbMerchantMembershipResolver(connection),
    allowedOrigins,
    webBaseUrl,
  });

  await app.listen({ port, host: "0.0.0.0" });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

void main();
