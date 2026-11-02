import { describe, expect, it } from "vitest";
import { AUDIT_LOG_GENESIS_HASH, computeRowHash } from "./hashChain.js";

const baseRow = {
  id: "audit-1",
  merchantId: "merchant-1",
  actorType: "USER",
  actorId: "user-1",
  action: "ROLE_CHANGED",
  entityType: "merchant_users",
  entityId: "merchant-1:user-2",
  beforeJson: JSON.stringify({ role: "STAFF" }),
  afterJson: JSON.stringify({ role: "ADMIN" }),
  ip: "203.0.113.7",
  userAgent: "test-agent/1.0",
  occurredAt: "2026-09-08T00:00:00.000Z",
};

describe("computeRowHash", () => {
  it("is deterministic for the same prevHash and row content", () => {
    const a = computeRowHash(AUDIT_LOG_GENESIS_HASH, baseRow);
    const b = computeRowHash(AUDIT_LOG_GENESIS_HASH, baseRow);
    expect(a).toBe(b);
  });

  it("is a 64-character lowercase hex SHA-256 digest", () => {
    const hash = computeRowHash(AUDIT_LOG_GENESIS_HASH, baseRow);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of key insertion order — canonical JSON, not raw JSON.stringify", () => {
    const reordered = {
      occurredAt: baseRow.occurredAt,
      userAgent: baseRow.userAgent,
      ip: baseRow.ip,
      afterJson: baseRow.afterJson,
      beforeJson: baseRow.beforeJson,
      entityId: baseRow.entityId,
      entityType: baseRow.entityType,
      action: baseRow.action,
      actorId: baseRow.actorId,
      actorType: baseRow.actorType,
      merchantId: baseRow.merchantId,
      id: baseRow.id,
    };

    expect(computeRowHash(AUDIT_LOG_GENESIS_HASH, baseRow)).toBe(
      computeRowHash(AUDIT_LOG_GENESIS_HASH, reordered),
    );
  });

  it("changes when any single field changes — the tamper-detection property", () => {
    const original = computeRowHash(AUDIT_LOG_GENESIS_HASH, baseRow);
    const tampered = computeRowHash(AUDIT_LOG_GENESIS_HASH, {
      ...baseRow,
      afterJson: JSON.stringify({ role: "OWNER" }),
    });
    expect(tampered).not.toBe(original);
  });

  it("changes when prevHash changes, chaining rows together", () => {
    const withGenesis = computeRowHash(AUDIT_LOG_GENESIS_HASH, baseRow);
    const withOtherPrev = computeRowHash("f".repeat(64), baseRow);
    expect(withGenesis).not.toBe(withOtherPrev);
  });
});
