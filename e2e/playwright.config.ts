import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_PORT = 3101;
const WEB_PORT = 3100;
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

// One SQLite file shared by the API server and this suite's seed fixtures
// (`fixtures/seed.ts` opens its own `createConnection` against the same
// path) — a fresh file per Playwright run, never `:memory:`, since the API
// server and the test process are two separate OS processes. This module
// is re-evaluated in each Playwright *worker* process, not just the main
// orchestrator that spawns `webServer` — an unconditional `mkdtempSync`
// here would mint a second, different path in the worker, silently
// pointed at an empty file the API server never sees (found the hard way:
// fixtures wrote and read back their own seed successfully, while every
// real HTTP request against the running API 404'd on the same slug). Only
// compute a path when one hasn't already been inherited from the parent.
process.env.E2E_DB_FILE ??= join(mkdtempSync(join(tmpdir(), "smb-os-e2e-")), "e2e.sqlite");
const dbFile = process.env.E2E_DB_FILE;
process.env.E2E_API_BASE_URL = API_BASE_URL;
process.env.E2E_WEB_BASE_URL = WEB_BASE_URL;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: WEB_BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @smb-os/api exec tsx watch src/serve.ts",
      cwd: repoRoot,
      url: `${API_BASE_URL}/health`,
      env: {
        PORT: String(API_PORT),
        DB_FILE: dbFile,
        WEB_BASE_URL,
        ALLOWED_ORIGINS: WEB_BASE_URL,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // `next dev`'s webpack devtool evaluates chunks via `eval(...)`,
      // which this app's own strict CSP (`apps/web/src/security/csp.ts`,
      // no `unsafe-eval`) correctly blocks in a real browser — only found
      // by running against an actual Chromium instance (jsdom-based
      // component tests never load a real script, so this never
      // surfaced there). `next build && next start` runs the same
      // production bundles a real deployment serves, so this suite tests
      // against real script-loading behavior, not a dev-mode artifact.
      // `NEXT_PUBLIC_API_URL` is inlined at *build* time (webpack
      // `DefinePlugin`), so it must be set for the build step too, not
      // just `next start`.
      command: "pnpm --filter @smb-os/web build && pnpm --filter @smb-os/web start",
      cwd: repoRoot,
      url: WEB_BASE_URL,
      env: {
        // Read server-side by `apps/web/src/middleware.ts` (the CSP's
        // `connect-src` allowlist) and client-side by every page's own
        // `fetch(...)` call — both must resolve to the same API origin,
        // or the CSP allows one origin while the browser calls another.
        API_URL: API_BASE_URL,
        NEXT_PUBLIC_API_URL: API_BASE_URL,
        // `next start` reads `PORT` itself — simpler than threading a
        // `-p` flag through two layers of `pnpm --filter ... <script>`.
        PORT: String(WEB_PORT),
      },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
