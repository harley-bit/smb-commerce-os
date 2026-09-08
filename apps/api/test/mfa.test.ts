import { Secret, TOTP } from "otpauth";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

const EMAIL = "owner@example.com";
const PASSWORD = "correct horse battery staple 42!";

function currentCode(secretBase32: string, email: string): string {
  return new TOTP({
    issuer: "SMB Commerce OS",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate();
}

describe("MFA enrollment endpoints (ADR-002: mandatory TOTP for OWNER/ADMIN)", () => {
  it("rejects login for a freshly registered OWNER until MFA is enrolled and confirmed", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(loginRes.statusCode).toBe(409);
    expect(loginRes.json()).toMatchObject({ mfaEnrollmentRequired: true });

    await app.close();
  });

  it("enrolls, then rejects a wrong confirmation code, then confirms with the right one", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });

    const enrollRes = await app.inject({
      method: "POST",
      url: "/auth/mfa/enroll",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(enrollRes.statusCode).toBe(200);
    const { secret, otpauthUrl } = enrollRes.json() as { secret: string; otpauthUrl: string };
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    const badConfirmRes = await app.inject({
      method: "POST",
      url: "/auth/mfa/confirm",
      payload: { email: EMAIL, password: PASSWORD, code: "000000" },
    });
    expect(badConfirmRes.statusCode).toBe(400);

    const confirmRes = await app.inject({
      method: "POST",
      url: "/auth/mfa/confirm",
      payload: { email: EMAIL, password: PASSWORD, code: currentCode(secret, EMAIL) },
    });
    expect(confirmRes.statusCode).toBe(200);

    await app.close();
  });

  it("requires a code and rejects a wrong one on login once MFA is confirmed, then accepts the right one", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });
    const enrollRes = await app.inject({
      method: "POST",
      url: "/auth/mfa/enroll",
      payload: { email: EMAIL, password: PASSWORD },
    });
    const { secret } = enrollRes.json() as { secret: string };
    await app.inject({
      method: "POST",
      url: "/auth/mfa/confirm",
      payload: { email: EMAIL, password: PASSWORD, code: currentCode(secret, EMAIL) },
    });

    const noCodeRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(noCodeRes.statusCode).toBe(401);
    expect(noCodeRes.json()).toMatchObject({ mfaCodeRequired: true });

    const wrongCodeRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD, mfaCode: "000000" },
    });
    expect(wrongCodeRes.statusCode).toBe(401);

    const rightCodeRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD, mfaCode: currentCode(secret, EMAIL) },
    });
    expect(rightCodeRes.statusCode).toBe(200);

    await app.close();
  });

  it("rejects enrollment and confirmation with the wrong password", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/auth/register", payload: { email: EMAIL, password: PASSWORD } });

    const enrollRes = await app.inject({
      method: "POST",
      url: "/auth/mfa/enroll",
      payload: { email: EMAIL, password: "wrong-password" },
    });
    expect(enrollRes.statusCode).toBe(401);

    const confirmRes = await app.inject({
      method: "POST",
      url: "/auth/mfa/confirm",
      payload: { email: EMAIL, password: "wrong-password", code: "000000" },
    });
    expect(confirmRes.statusCode).toBe(401);

    await app.close();
  });

  it("rejects enroll/confirm requests missing required fields", async () => {
    const app = buildApp();

    const badEnroll = await app.inject({ method: "POST", url: "/auth/mfa/enroll", payload: { email: EMAIL } });
    expect(badEnroll.statusCode).toBe(400);

    const badConfirm = await app.inject({
      method: "POST",
      url: "/auth/mfa/confirm",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(badConfirm.statusCode).toBe(400);

    await app.close();
  });
});
