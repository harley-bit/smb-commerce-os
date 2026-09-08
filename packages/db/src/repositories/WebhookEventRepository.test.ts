import { DuplicateWebhookEventError } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import { WebhookEventRepository } from "./WebhookEventRepository.js";

describe("WebhookEventRepository", () => {
  let connection: Connection;
  let events: WebhookEventRepository;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    events = new WebhookEventRepository(connection);
  });

  function recordEvent(eventId = "evt_1", payloadJson = '{"id":"evt_1"}') {
    return events.record({
      provider: "STRIPE",
      eventId,
      payloadJson,
      receivedAt: "2026-09-08T00:00:00.000Z",
    });
  }

  it("records a new webhook event and reads it back", () => {
    const id = recordEvent();

    expect(events.findByProviderEventId("STRIPE", "evt_1")).toMatchObject({
      id,
      provider: "STRIPE",
      eventId: "evt_1",
      payloadJson: '{"id":"evt_1"}',
    });
  });

  it("D092 acceptance criteria: rejects a duplicate (provider, event_id) with a domain error — a replayed delivery is recognized, not reprocessed", () => {
    recordEvent("evt_dupe");

    expect(() => recordEvent("evt_dupe")).toThrow(DuplicateWebhookEventError);
    // Only the first row exists; the rejected duplicate wrote nothing new.
    expect(events.findByProviderEventId("STRIPE", "evt_dupe")).toBeDefined();
  });

  it("allows the same event_id across two different providers", () => {
    events.record({
      provider: "STRIPE",
      eventId: "evt_shared",
      payloadJson: "{}",
      receivedAt: "2026-09-08T00:00:00.000Z",
    });

    expect(() =>
      events.record({
        provider: "OTHER_PROVIDER",
        eventId: "evt_shared",
        payloadJson: "{}",
        receivedAt: "2026-09-08T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("returns undefined for an event id that was never received", () => {
    expect(events.findByProviderEventId("STRIPE", "evt_missing")).toBeUndefined();
  });
});
