import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

describe("API skeleton (D035)", () => {
  it("GET /health responds 200 with no PII/tokens/stack traces", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready responds 200 when the app can accept traffic", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("generates an X-Request-Id when the client doesn't send one", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-request-id"]).toEqual(expect.any(String));
    expect((res.headers["x-request-id"] as string).length).toBeGreaterThan(0);
  });

  it("echoes back a client-supplied X-Request-Id instead of replacing it", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "client-supplied-id-123" },
    });
    expect(res.headers["x-request-id"]).toBe("client-supplied-id-123");
  });

  it("returns RFC 9457 problem+json for a 404", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json() as { type: string; title: string; status: number; detail?: string; instance: string };
    expect(body.type).toEqual(expect.any(String));
    expect(body.title).toEqual(expect.any(String));
    expect(body.status).toBe(404);
    expect(body.instance).toEqual(expect.any(String));
  });

  it("returns RFC 9457 problem+json for an unhandled 500, without leaking a stack trace", async () => {
    const app = buildApp();
    app.get("/__boom", () => {
      throw new Error("sensitive internal detail: db password is hunter2");
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/__boom" });
    expect(res.statusCode).toBe(500);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json() as { type: string; title: string; status: number; detail?: string; instance: string };
    expect(body.status).toBe(500);
    expect(body.type).toEqual(expect.any(String));
    expect(body.title).toEqual(expect.any(String));
    // The security check: no stack trace, no internal error message, in the response body.
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("at ");
    expect(body.instance).toEqual(expect.any(String));
  });

  it("logs are structured JSON and include the request id, without logging PII or tokens", async () => {
    const lines: string[] = [];
    const app = buildApp({
      loggerStream: {
        write: (line: string) => {
          lines.push(line);
        },
      },
    });
    await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-request-id": "log-test-id" },
      payload: { email: "someone@example.com", password: "super-secret-password" },
    });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(line).not.toContain("super-secret-password");
      expect(line).not.toContain("someone@example.com");
    }
    const joined = lines.join("\n");
    expect(joined).toContain("log-test-id");
  });
});
