import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

/**
 * `docs/cards/D136.md` — found while wiring the first real, browser-driven
 * E2E run against a live `apps/web` + `apps/api`: `app.inject()` (every
 * other test in this suite) never exercises real browser CORS enforcement,
 * so this codebase had no `Access-Control-Allow-Origin` response header at
 * all — every one of `apps/web`'s cross-origin `fetch(..., { credentials:
 * "include" })` calls would be silently blocked by the browser itself, a
 * gap invisible to every prior test in this repo. The origin allowlist
 * this uses is the same `allowedOrigins` option `./auth/originCheck.ts`'s
 * CSRF defense already reads — one list, two enforcement layers (browser
 * CORS + server-side origin check on state-changing requests).
 */
describe("CORS", () => {
  it("reflects an allow-listed origin with credentials support on a real (non-injected) response", async () => {
    const app = buildApp({ allowedOrigins: ["http://127.0.0.1:3100"] });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://127.0.0.1:3100" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3100");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    await app.close();
  });

  it("never reflects a disallowed origin", async () => {
    const app = buildApp({ allowedOrigins: ["http://127.0.0.1:3100"] });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example.com" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("answers a preflight OPTIONS request for an allow-listed origin", async () => {
    const app = buildApp({ allowedOrigins: ["http://127.0.0.1:3100"] });
    await app.ready();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/m/some-slug/account/orders",
      headers: {
        origin: "http://127.0.0.1:3100",
        "access-control-request-method": "GET",
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3100");
    await app.close();
  });
});
