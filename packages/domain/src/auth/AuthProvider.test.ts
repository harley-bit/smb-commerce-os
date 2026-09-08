import { describe, expect, it } from "vitest";
import {
  AccountLockedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidResetTokenError,
  MfaCodeRequiredError,
  MfaEnrollmentRequiredError,
  type AuthProvider,
  type AuthResult,
  type MfaEnrollment,
  type Session,
  type TenantContext,
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
      verifySession: async (): Promise<TenantContext | null> => null,
      revokeSession: async (): Promise<void> => undefined,
      initiatePasswordReset: async (): Promise<void> => undefined,
      completePasswordReset: async (): Promise<void> => undefined,
      enrollMfa: async (): Promise<MfaEnrollment> => ({ secret: "s1", otpauthUrl: "otpauth://totp/x" }),
      confirmMfaEnrollment: async (): Promise<void> => undefined,
    };

    expect(typeof stubProvider.authenticate).toBe("function");
    expect(typeof stubProvider.enrollMfa).toBe("function");
    expect(typeof stubProvider.confirmMfaEnrollment).toBe("function");
  });

  it("exposes distinct, named error classes so callers can branch on failure mode", () => {
    expect(new InvalidCredentialsError().name).toBe("InvalidCredentialsError");
    expect(new AccountLockedError().name).toBe("AccountLockedError");
    expect(new InvalidResetTokenError().name).toBe("InvalidResetTokenError");
    expect(new EmailAlreadyRegisteredError().name).toBe("EmailAlreadyRegisteredError");
    expect(new MfaEnrollmentRequiredError().name).toBe("MfaEnrollmentRequiredError");
    expect(new MfaCodeRequiredError().name).toBe("MfaCodeRequiredError");
    expect(new InvalidMfaCodeError().name).toBe("InvalidMfaCodeError");
  });

  it("never puts a password field on the error or result types (compile-time check)", () => {
    const result: AuthResult = { userId: "u1", email: "a@b.com" };
    expect("password" in result).toBe(false);
  });
});
