import { createTenantContext, ForbiddenActionError, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { PaymentRepository } from "../repositories/PaymentRepository.js";
import { SimulatedPayoutProvider } from "../payments/SimulatedPayoutProvider.js";
import { PayoutReconciliationService } from "./PayoutReconciliationService.js";

describe("PayoutReconciliationService", () => {
  let connection: Connection;
  let orderRepo: OrderRepository;
  let paymentRepo: PaymentRepository;
  let auditLogRepo: AuditLogRepository;
  let provider: SimulatedPayoutProvider;
  let service: PayoutReconciliationService;
  let merchantA: string;
  let merchantB: string;
  let orderA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);

    orderRepo = new OrderRepository(connection);
    paymentRepo = new PaymentRepository(connection);
    auditLogRepo = new AuditLogRepository(connection);
    provider = new SimulatedPayoutProvider();
    service = new PayoutReconciliationService(paymentRepo, auditLogRepo, provider);

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    const userA = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values([
      {
        id: merchantA,
        name: "Merchant A",
        slug: "merchant-a",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
      {
        id: merchantB,
        name: "Merchant B",
        slug: "merchant-b",
        status: "ACTIVE",
        defaultCurrency: "USD",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ]);
    await connection.db.insert(sqliteSchema.users).values({
      id: userA,
      email: "a@example.com",
      status: "ACTIVE",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    orderA = orderRepo.create(createTenantContext(merchantA), {
      customerUserId: userA,
      status: "CONFIRMED",
      currency: "USD",
    });
  });

  function recordCharge(ctx = createTenantContext(merchantA), providerRef = "pi_charge_1", amountMinor = 10_000) {
    return paymentRepo.create(ctx, {
      orderId: orderA,
      provider: "stripe",
      providerRef,
      kind: "CHARGE",
      amountMinor,
      currency: "USD",
      status: "SUCCEEDED",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  }

  it("reconciles cleanly when the provider's payout matches our own recorded charge", async () => {
    recordCharge();
    provider.registerPayout({
      payoutId: "po_1",
      currency: "USD",
      arrivalDate: "2026-09-10",
      transactions: [{ providerRef: "pi_charge_1", grossAmountMinor: 10_000, feeMinor: 320, netAmountMinor: 9_680 }],
    });
    const ctx = createTenantContext(merchantA);

    const result = await service.reconcilePayout(ctx, "OWNER", "po_1");

    expect(result.hasMismatch).toBe(false);
    expect(result.netAmountMinor).toBe(9_680);
    expect(auditLogRepo.list(ctx)).toHaveLength(0);
  });

  it("security check: STAFF, READ_ONLY, and ADMIN cannot view the payout reconciliation — only OWNER may", async () => {
    recordCharge();
    provider.registerPayout({
      payoutId: "po_2",
      currency: "USD",
      arrivalDate: "2026-09-10",
      transactions: [{ providerRef: "pi_charge_1", grossAmountMinor: 10_000, feeMinor: 320, netAmountMinor: 9_680 }],
    });
    const ctx = createTenantContext(merchantA);

    for (const role of ["STAFF", "READ_ONLY", "ADMIN"] as const) {
      await expect(service.reconcilePayout(ctx, role, "po_2")).rejects.toThrow(ForbiddenActionError);
    }
  });

  it("flags a mismatch and appends an audit-log escalation entry when our ledger disagrees with the provider", async () => {
    recordCharge(createTenantContext(merchantA), "pi_charge_1", 9_000); // we recorded 9,000
    provider.registerPayout({
      payoutId: "po_3",
      currency: "USD",
      arrivalDate: "2026-09-10",
      transactions: [{ providerRef: "pi_charge_1", grossAmountMinor: 10_000, feeMinor: 320, netAmountMinor: 9_680 }], // provider says 10,000
    });
    const ctx = createTenantContext(merchantA);

    const result = await service.reconcilePayout(ctx, "OWNER", "po_3");

    expect(result.hasMismatch).toBe(true);
    const entries = auditLogRepo.list(ctx);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "payout.reconciliation_mismatch",
      entityType: "payout",
      entityId: "po_3",
      actorType: "SYSTEM",
    });
  });

  it("does not let merchant B reconcile against merchant A's own recorded payments", async () => {
    recordCharge();
    provider.registerPayout({
      payoutId: "po_4",
      currency: "USD",
      arrivalDate: "2026-09-10",
      transactions: [{ providerRef: "pi_charge_1", grossAmountMinor: 10_000, feeMinor: 320, netAmountMinor: 9_680 }],
    });
    const ctxB = createTenantContext(merchantB);

    // Merchant B has no payments row for pi_charge_1 at all under its own tenant scope, so this must read as a mismatch, not merchant A's data.
    const result = await service.reconcilePayout(ctxB, "OWNER", "po_4");

    expect(result.hasMismatch).toBe(true);
    expect(result.lines[0]?.ourAmountMinor).toBeNull();
  });
});
