import { AUTHORIZATION_WINDOW_CEILING_DAYS } from "@smb-os/domain";
import { describe, expect, it } from "vitest";
import { SimulatedDepositHoldProvider } from "./SimulatedDepositHoldProvider.js";

describe("SimulatedDepositHoldProvider", () => {
  it("creates a hold with a mandatory expiresAt derived from the provider's window", async () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    const provider = new SimulatedDepositHoldProvider(() => now, 7);

    const result = await provider.createManualCaptureHold({
      orderLineId: "line-1",
      amountMinor: 20000,
      currency: "USD",
      connectedAccountId: "acct_123",
      idempotencyKey: "idem-1",
    });

    expect(result.expiresAt).toBe("2026-09-15T00:00:00.000Z");
    expect(result.amountMinor).toBe(20000);
    expect(result.currency).toBe("USD");
    expect(result.intentId).toMatch(/^pi_/);
  });

  it("never produces a window above the 30-day product ceiling even if configured higher", async () => {
    const provider = new SimulatedDepositHoldProvider(() => new Date(), 90);

    await expect(
      provider.createManualCaptureHold({
        orderLineId: "line-1",
        amountMinor: 20000,
        currency: "USD",
        connectedAccountId: "acct_123",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow(`${AUTHORIZATION_WINDOW_CEILING_DAYS}-day product ceiling`);
  });

  it("replays the original hold for a repeated idempotency key instead of minting a second one", async () => {
    const provider = new SimulatedDepositHoldProvider();

    const first = await provider.createManualCaptureHold({
      orderLineId: "line-1",
      amountMinor: 20000,
      currency: "USD",
      connectedAccountId: "acct_123",
      idempotencyKey: "idem-1",
    });
    const second = await provider.createManualCaptureHold({
      orderLineId: "line-1",
      amountMinor: 20000,
      currency: "USD",
      connectedAccountId: "acct_123",
      idempotencyKey: "idem-1",
    });

    expect(second.intentId).toBe(first.intentId);
  });

  it("rejects a hold with no idempotency key", async () => {
    const provider = new SimulatedDepositHoldProvider();

    await expect(
      provider.createManualCaptureHold({
        orderLineId: "line-1",
        amountMinor: 20000,
        currency: "USD",
        connectedAccountId: "acct_123",
        idempotencyKey: "",
      }),
    ).rejects.toThrow("Idempotency-Key is required");
  });
});
