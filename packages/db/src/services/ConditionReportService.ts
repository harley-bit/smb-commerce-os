import { assertCan, computeConditionGradeDelta, type ConditionGradeDelta, type TenantContext } from "@smb-os/domain";
import type { MerchantUserRole } from "../repositories/MerchantUserRepository.js";
import type { OrderRepository } from "../repositories/OrderRepository.js";
import {
  type ConditionReport,
  type ConditionReportRepository,
} from "../repositories/ConditionReportRepository.js";
import { OrderLineNotFoundError } from "./FulfillmentEventService.js";

export interface RecordCheckoutInput {
  orderLineId: string;
  inventoryUnitId: string;
  conditionGrade: string;
  notes?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface RecordCheckinInput {
  orderLineId: string;
  inventoryUnitId: string;
  conditionGrade: string;
  notes?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface RecordCheckinResult {
  checkinReportId: string;
  checkoutReport: ConditionReport;
  checkinReport: ConditionReport;
  delta: ConditionGradeDelta;
}

/**
 * `docs/cards/D075.md` security check — a CHECKIN grade recorded with no
 * CHECKOUT baseline on file is one-sided evidence: it can be used to accuse
 * a customer of damage that may have existed at pickup, but can never be
 * used to *clear* one either, since there's nothing to compare against.
 * Thrown before the CHECKIN report is written, mirroring
 * `MissingCheckoutConditionReportError`'s (`FulfillmentEventService`, D072)
 * "reject before writing anything" shape for the same invariant I7 baseline.
 */
export class MissingCheckoutBaselineError extends Error {
  constructor(public readonly orderLineId: string) {
    super(`A CHECKOUT condition report is required before a CHECKIN can be recorded for order line ${orderLineId}`);
    this.name = "MissingCheckoutBaselineError";
  }
}

/**
 * `docs/cards/D075.md` — the CHECKIN half of the condition-report trail
 * `ConditionReportRepository` (D072) modeled but never had a caller for.
 * `recordCheckin` requires the order line's CHECKOUT baseline to already
 * exist, writes the CHECKIN report, and returns both reports plus the
 * computed grade delta (`@smb-os/domain`'s `computeConditionGradeDelta`) so
 * a merchant reviewing a return sees the full before/after picture in one
 * call, not just the new report in isolation — the security check's "fair
 * evidence" requirement answered by construction: the same response that
 * would support a damage claim is the one that would defeat a false one.
 */
export class ConditionReportService {
  constructor(
    private readonly conditionReports: ConditionReportRepository,
    private readonly orderLines: OrderRepository,
  ) {}

  /**
   * `docs/cards/D116.md` — the CHECKOUT half of the trail `recordCheckin`
   * (D075) already had a caller for. Writing this through the service
   * layer, rather than the repository directly, means `bookings:manage`
   * and cross-tenant order-line ownership are checked the same way for
   * every write here, not just for CHECKIN — a caller who names another
   * merchant's `orderLineId` gets `OrderLineNotFoundError`, not a written
   * CHECKOUT report scoped to their own tenant but describing someone
   * else's rental.
   */
  recordCheckout(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: RecordCheckoutInput,
  ): ConditionReport {
    assertCan({ role: actingRole }, "bookings:manage");

    const line = this.orderLines.findLineById(ctx, input.orderLineId);
    if (!line) {
      throw new OrderLineNotFoundError(input.orderLineId);
    }

    const reportId = this.conditionReports.create(ctx, {
      orderLineId: input.orderLineId,
      inventoryUnitId: input.inventoryUnitId,
      phase: "CHECKOUT",
      conditionGrade: input.conditionGrade,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });

    const report = this.conditionReports.findById(ctx, reportId);
    if (!report) {
      throw new Error("Condition report vanished immediately after being written");
    }
    return report;
  }

  recordCheckin(
    ctx: TenantContext,
    actingRole: MerchantUserRole,
    input: RecordCheckinInput,
  ): RecordCheckinResult {
    assertCan({ role: actingRole }, "bookings:manage");

    const reports = this.conditionReports.listByOrderLine(ctx, input.orderLineId);
    const checkoutReport = reports.find((report) => report.phase === "CHECKOUT");
    if (!checkoutReport) {
      throw new MissingCheckoutBaselineError(input.orderLineId);
    }

    const checkinReportId = this.conditionReports.create(ctx, {
      orderLineId: input.orderLineId,
      inventoryUnitId: input.inventoryUnitId,
      phase: "CHECKIN",
      conditionGrade: input.conditionGrade,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });

    const checkinReport = this.conditionReports.findById(ctx, checkinReportId);
    if (!checkinReport) {
      throw new Error("Condition report vanished immediately after being written");
    }

    const delta = computeConditionGradeDelta(checkoutReport.conditionGrade, checkinReport.conditionGrade);

    return { checkinReportId, checkoutReport, checkinReport, delta };
  }
}
