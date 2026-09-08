import { AUTHORIZATION_WINDOW_CEILING_DAYS, DepositHoldAlreadyResolvedError } from "@smb-os/domain";
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

  async function createHold(provider: SimulatedDepositHoldProvider, amountMinor = 20000) {
    return provider.createManualCaptureHold({
      orderLineId: "line-1",
      amountMinor,
      currency: "USD",
      connectedAccountId: "acct_123",
      idempotencyKey: `idem-${amountMinor}-${Math.random()}`,
    });
  }

  it("captures the full authorized amount with no released remainder", async () => {
    const provider = new SimulatedDepositHoldProvider();
    const hold = await createHold(provider, 20000);

    const result = await provider.captureManualCaptureHold({
      intentId: hold.intentId,
      amountMinor: 20000,
      idempotencyKey: "cap-1",
    });

    expect(result).toMatchObject({ intentId: hold.intentId, capturedMinor: 20000, releasedRemainderMinor: 0 });
  });

  it("a partial capture releases the remainder of the hold in the same call", async () => {
    const provider = new SimulatedDepositHoldProvider();
    const hold = await createHold(provider, 20000);

    const result = await provider.captureManualCaptureHold({
      intentId: hold.intentId,
      amountMinor: 12000,
      idempotencyKey: "cap-2",
    });

    expect(result).toMatchObject({ capturedMinor: 12000, releasedRemainderMinor: 8000 });
  });

  it("rejects a second capture attempt on an already-captured intent at the provider layer", async () => {
    const provider = new SimulatedDepositHoldProvider();
    const hold = await createHold(provider, 20000);

    await provider.captureManualCaptureHold({ intentId: hold.intentId, amountMinor: 20000, idempotencyKey: "cap-3" });

    await expect(
      provider.captureManualCaptureHold({ intentId: hold.intentId, amountMinor: 20000, idempotencyKey: "cap-4" }),
    ).rejects.toThrow(DepositHoldAlreadyResolvedError);
  });

  it("rejects capturing an intent that was already released at the provider layer", async () => {
    const provider = new SimulatedDepositHoldProvider();
    const hold = await createHold(provider, 20000);

    await provider.releaseManualCaptureHold({ intentId: hold.intentId });

    await expect(
      provider.captureManualCaptureHold({ intentId: hold.intentId, amountMinor: 20000, idempotencyKey: "cap-5" }),
    ).rejects.toThrow(DepositHoldAlreadyResolvedError);
  });

  it("rejects a second release attempt on an already-resolved intent", async () => {
    const provider = new SimulatedDepositHoldProvider();
    const hold = await createHold(provider, 20000);

    await provider.releaseManualCaptureHold({ intentId: hold.intentId });

    await expect(provider.releaseManualCaptureHold({ intentId: hold.intentId })).rejects.toThrow(
      DepositHoldAlreadyResolvedError,
    );
  });

  it("rejects a capture amount above the authorized amount at the provider layer", async () => {
    const provider = new SimulatedDepositHoldProvider();
    const hold = await createHold(provider, 20000);

    await expect(
      provider.captureManualCaptureHold({ intentId: hold.intentId, amountMinor: 20001, idempotencyKey: "cap-6" }),
    ).rejects.toThrow();
  });

  it("replays the original capture result for a repeated idempotency key instead of capturing twice", async () => {
    const provider = new SimulatedDepositHoldProvider();
    const hold = await createHold(provider, 20000);

    const first = await provider.captureManualCaptureHold({
      intentId: hold.intentId,
      amountMinor: 12000,
      idempotencyKey: "cap-7",
    });
    const second = await provider.captureManualCaptureHold({
      intentId: hold.intentId,
      amountMinor: 12000,
      idempotencyKey: "cap-7",
    });

    expect(second).toEqual(first);
  });
});
