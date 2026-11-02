import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeWebhookSignature } from "./WebhookSignatureVerifier.js";

const SECRET = "whsec_test_secret";

function sign(payload: string, timestamp: number, secret = SECRET): string {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyStripeWebhookSignature", () => {
  it("D091 acceptance criteria: accepts a correctly signed event and returns the parsed payload", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
    const now = Math.floor(Date.now() / 1000);
    const header = sign(payload, now);

    const result = verifyStripeWebhookSignature(payload, header, SECRET, { now: () => now * 1000 });

    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.event).toEqual({ id: "evt_1", type: "payment_intent.succeeded" });
    }
  });

  it("D091 acceptance criteria: rejects an unsigned event (missing header) and never parses the body", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });

    const result = verifyStripeWebhookSignature(payload, undefined, SECRET);

    expect(result.verified).toBe(false);
    expect(result).not.toHaveProperty("event");
  });

  it("D091 acceptance criteria: rejects a wrongly-signed event (forged with a different secret)", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
    const now = Math.floor(Date.now() / 1000);
    const forgedHeader = sign(payload, now, "whsec_attacker_secret");

    const result = verifyStripeWebhookSignature(payload, forgedHeader, SECRET, { now: () => now * 1000 });

    expect(result.verified).toBe(false);
  });

  it("rejects a signature computed over a tampered payload", () => {
    const originalPayload = JSON.stringify({ id: "evt_1", amountMinor: 100 });
    const tamperedPayload = JSON.stringify({ id: "evt_1", amountMinor: 100_000 });
    const now = Math.floor(Date.now() / 1000);
    const header = sign(originalPayload, now);

    const result = verifyStripeWebhookSignature(tamperedPayload, header, SECRET, { now: () => now * 1000 });

    expect(result.verified).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    const payload = JSON.stringify({ id: "evt_1" });

    const result = verifyStripeWebhookSignature(payload, "not-a-valid-header", SECRET);

    expect(result.verified).toBe(false);
  });

  it("rejects an expired timestamp outside the replay tolerance window", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const now = Math.floor(Date.now() / 1000);
    const staleTimestamp = now - 3600;
    const header = sign(payload, staleTimestamp);

    const result = verifyStripeWebhookSignature(payload, header, SECRET, { now: () => now * 1000 });

    expect(result.verified).toBe(false);
  });

  it("rejects when no signature matches, even if the header carries multiple v1 candidates", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const now = Math.floor(Date.now() / 1000);
    const header = `t=${now},v1=deadbeef,v1=cafebabe`;

    const result = verifyStripeWebhookSignature(payload, header, SECRET, { now: () => now * 1000 });

    expect(result.verified).toBe(false);
  });
});
