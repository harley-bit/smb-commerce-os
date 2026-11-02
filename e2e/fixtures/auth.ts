import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { Secret, TOTP } from "otpauth";

/**
 * `docs/cards/D136.md` — no customer-facing login/registration/MFA-enrollment
 * UI exists anywhere in `apps/web` yet (only `apps/web/src/app/login/page.tsx`,
 * an email/password form with no MFA step at all, and MFA is mandatory for
 * *every* account — `NativeAuthProvider.register` always assigns the global
 * `roles: ["OWNER"]`, and `MFA_REQUIRED_ROLES` checks exactly that field, so
 * even a plain storefront customer hits `MfaEnrollmentRequiredError` on
 * first login). Building that UI is its own multi-card epic, not this
 * gate's job. This fixture authenticates the same way a real customer's
 * browser eventually will — real HTTP calls against the real running API
 * (`/auth/register`, `/auth/mfa/enroll`, `/auth/mfa/confirm`, `/auth/login`)
 * — then injects the resulting session cookie straight into the browser
 * context, so the *page* under test always starts from an already-signed-in
 * state, same as a returning customer would.
 */
export interface AuthenticatedCustomer {
  userId: string;
  email: string;
  sessionToken: string;
}

function currentTotpCode(secretBase32: string, email: string): string {
  return new TOTP({
    issuer: "SMB Commerce OS",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate();
}

/** Registers a fresh customer, enrolls + confirms MFA, and logs in — real HTTP throughout, no browser involved. */
export async function registerCustomer(request: APIRequestContext, apiBaseUrl: string): Promise<AuthenticatedCustomer> {
  const email = `e2e-customer-${crypto.randomUUID()}@example.com`;
  const password = "correct horse battery staple 42!";

  const registerRes = await request.post(`${apiBaseUrl}/auth/register`, { data: { email, password } });
  if (!registerRes.ok()) {
    throw new Error(`register failed: ${registerRes.status()} ${await registerRes.text()}`);
  }
  const { userId } = (await registerRes.json()) as { userId: string; email: string };

  const enrollRes = await request.post(`${apiBaseUrl}/auth/mfa/enroll`, { data: { email, password } });
  if (!enrollRes.ok()) {
    throw new Error(`mfa enroll failed: ${enrollRes.status()} ${await enrollRes.text()}`);
  }
  const { secret } = (await enrollRes.json()) as { secret: string; otpauthUrl: string };

  const confirmRes = await request.post(`${apiBaseUrl}/auth/mfa/confirm`, {
    data: { email, password, code: currentTotpCode(secret, email) },
  });
  if (!confirmRes.ok()) {
    throw new Error(`mfa confirm failed: ${confirmRes.status()} ${await confirmRes.text()}`);
  }

  const loginRes = await request.post(`${apiBaseUrl}/auth/login`, {
    data: { email, password, mfaCode: currentTotpCode(secret, email) },
  });
  if (!loginRes.ok()) {
    throw new Error(`login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
  const setCookie = loginRes.headers()["set-cookie"];
  const token = setCookie?.match(/session=([^;]+)/)?.[1];
  if (!token) {
    throw new Error("login succeeded but no session cookie was set");
  }

  return { userId, email, sessionToken: token };
}

/**
 * `secure: false` below is a *test-fixture-only* concession — the running
 * API server sets `secure: true` on the real `Set-Cookie` (`app.ts`'s
 * `/auth/login` handler), correct for a real HTTPS deployment. This local
 * E2E run has no TLS in front of it (out of scope for this card), so this
 * fixture reconstructs the cookie by hand from the raw session token
 * rather than relying on the browser to accept a `secure` cookie over
 * plain `http://127.0.0.1`. No production code is affected by this.
 */
export async function attachSession(context: BrowserContext, customer: AuthenticatedCustomer, webHostname: string): Promise<void> {
  await context.addCookies([
    {
      name: "session",
      value: customer.sessionToken,
      domain: webHostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Strict",
    },
  ]);
}

/** Convenience wrapper for the common case: register, log in, and put the session in the browser in one call. */
export async function registerAndLogin(
  request: APIRequestContext,
  context: BrowserContext,
  apiBaseUrl: string,
  webHostname: string,
): Promise<AuthenticatedCustomer> {
  const customer = await registerCustomer(request, apiBaseUrl);
  await attachSession(context, customer, webHostname);
  return customer;
}
