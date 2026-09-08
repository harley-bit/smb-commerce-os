import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const SECRET = "whsec_test_secret";

function sign(payload: string, timestamp: number, secret = SECRET): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("POST /webhooks/stripe (D091)", () => {
  it("D091 acceptance criteria: accepts a correctly signed event", async () => {
    const app = buildApp({ stripeWebhookSecret: SECRET });
    const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
    const now = Math.floor(Date.now() / 1000);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": sign(payload, now) },
      payload,
    });

    expect(response.statusCode).toBe(200);
  });

  it("D091 acceptance criteria: rejects an unsigned event", async () => {
    const app = buildApp({ stripeWebhookSecret: SECRET });
    const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload,
    });

    expect(response.statusCode).toBe(400);
  });

  it("D091 acceptance criteria: rejects a wrongly-signed event and never trusts its body", async () => {
    const app = buildApp({ stripeWebhookSecret: SECRET });
    const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded", releaseDeposit: true });
    const now = Math.floor(Date.now() / 1000);
    const forged = sign(payload, now, "whsec_attacker_secret");

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": forged },
      payload,
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.detail).not.toContain("releaseDeposit");
  });

  it("this card's security check: logs a security event on an unverified webhook instead of processing it", async () => {
    const logLines: string[] = [];
    const app = buildApp({
      stripeWebhookSecret: SECRET,
      loggerStream: { write: (chunk: string) => void logLines.push(chunk) },
    });
    const payload = JSON.stringify({ id: "evt_1" });

    await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": "t=123,v1=deadbeef" },
      payload,
    });

    const securityLog = logLines.find((line) => line.includes("webhook_signature_verification_failed"));
    expect(securityLog).toBeDefined();
  });
});
