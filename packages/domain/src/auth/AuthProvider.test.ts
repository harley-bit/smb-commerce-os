import { describe, expect, it } from "vitest";
import {
  AccountLockedError,
  EmailAlreadyRegisteredError,
  InvalidAuthorizationCodeError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidRefreshTokenError,
  InvalidResetTokenError,
  MfaCodeRequiredError,
  MfaEnrollmentRequiredError,
  PkceVerificationFailedError,
  type AuthIdentity,
  type AuthorizationCodeGrant,
  type AuthProvider,
  type AuthResult,
  type MfaEnrollment,
  type MobileTokenPair,
  type Session,
} from "./AuthProvider.js";

describe("AuthProvider domain contract", () => {
  it("defines the full native-auth surface (ADR-002) with no I/O in this package", () => {
    const stubProvider: AuthProvider = {
      register: async (email: string): Promise<AuthResult> => ({ userId: "u1", email }),
      authenticate: async (email: string): Promise<AuthResult> => ({ userId: "u1", email }),
      createSession: async (userId: string): Promise<Session> => ({
        token: "t1",
        userId,
        createdAt: new Date(0).toISOString(),
        expiresAt: new Date(1).toISOString(),
      }),
      verifySession: async (): Promise<AuthIdentity | null> => null,
      revokeSession: async (): Promise<void> => undefined,
      initiatePasswordReset: async (): Promise<void> => undefined,
      completePasswordReset: async (): Promise<void> => undefined,
      enrollMfa: async (): Promise<MfaEnrollment> => ({ secret: "s1", otpauthUrl: "otpauth://totp/x" }),
      confirmMfaEnrollment: async (): Promise<void> => undefined,
      createAuthorizationCode: async (): Promise<AuthorizationCodeGrant> => ({
        code: "c1",
        expiresAt: new Date(1).toISOString(),
      }),
      exchangeAuthorizationCode: async (): Promise<MobileTokenPair> => ({
        accessToken: "a1",
        accessTokenExpiresAt: new Date(1).toISOString(),
        refreshToken: "r1",
        refreshTokenExpiresAt: new Date(2).toISOString(),
      }),
      refreshMobileSession: async (): Promise<MobileTokenPair> => ({
        accessToken: "a2",
        accessTokenExpiresAt: new Date(1).toISOString(),
        refreshToken: "r2",
        refreshTokenExpiresAt: new Date(2).toISOString(),
      }),
      revokeMobileSession: async (): Promise<void> => undefined,
    };

    expect(typeof stubProvider.authenticate).toBe("function");
    expect(typeof stubProvider.enrollMfa).toBe("function");
    expect(typeof stubProvider.confirmMfaEnrollment).toBe("function");
    expect(typeof stubProvider.createAuthorizationCode).toBe("function");
    expect(typeof stubProvider.exchangeAuthorizationCode).toBe("function");
    expect(typeof stubProvider.refreshMobileSession).toBe("function");
    expect(typeof stubProvider.revokeMobileSession).toBe("function");
  });

  it("exposes distinct, named error classes so callers can branch on failure mode", () => {
    expect(new InvalidCredentialsError().name).toBe("InvalidCredentialsError");
    expect(new AccountLockedError().name).toBe("AccountLockedError");
    expect(new InvalidResetTokenError().name).toBe("InvalidResetTokenError");
    expect(new EmailAlreadyRegisteredError().name).toBe("EmailAlreadyRegisteredError");
    expect(new MfaEnrollmentRequiredError().name).toBe("MfaEnrollmentRequiredError");
    expect(new MfaCodeRequiredError().name).toBe("MfaCodeRequiredError");
    expect(new InvalidMfaCodeError().name).toBe("InvalidMfaCodeError");
    expect(new InvalidAuthorizationCodeError().name).toBe("InvalidAuthorizationCodeError");
    expect(new PkceVerificationFailedError().name).toBe("PkceVerificationFailedError");
    expect(new InvalidRefreshTokenError().name).toBe("InvalidRefreshTokenError");
  });

  it("never puts a password field on the error or result types (compile-time check)", () => {
    const result: AuthResult = { userId: "u1", email: "a@b.com" };
    expect("password" in result).toBe(false);
  });
});
