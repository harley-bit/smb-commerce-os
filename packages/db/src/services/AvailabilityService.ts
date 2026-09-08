import {
  computeFreeIntervals,
  expandAvailabilityRule,
  makeInterval,
  type AvailabilityException as DomainAvailabilityException,
  type AvailabilityRule as DomainAvailabilityRule,
  type Interval,
  type TenantContext,
} from "@smb-os/domain";
import type { AvailabilityCache } from "../cache/AvailabilityCache.js";
import type { AvailabilityExceptionRepository } from "../repositories/AvailabilityExceptionRepository.js";
import type { AvailabilityRule, AvailabilityRuleRepository } from "../repositories/AvailabilityRuleRepository.js";
import type { LocationRepository } from "../repositories/LocationRepository.js";
import type { ReservationRepository } from "../repositories/ReservationRepository.js";
import type { ResourceRepository } from "../repositories/ResourceRepository.js";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export class AvailabilityRangeTooLargeError extends Error {
  constructor(from: string, to: string) {
    super(`Availability window from=${from} to=${to} exceeds the 90-day cap`);
    this.name = "AvailabilityRangeTooLargeError";
  }
}

export class ResourceNotFoundError extends Error {
  constructor(resourceId: string) {
    super(`Resource not found: ${resourceId}`);
    this.name = "ResourceNotFoundError";
  }
}

/**
 * Clips a rule's `[validFrom, validTo)` bound (`docs/design/03` — "the date
 * range the rule applies over") against the query window, so a rule that
 * lapsed before `from` or hasn't started by `to` contributes nothing, and a
 * rule that only partially overlaps the window is expanded over just the
 * overlapping part. Returns `null` when there is no overlap at all.
 */
function clampToRuleValidity(
  rule: Pick<AvailabilityRule, "validFrom" | "validTo">,
  from: string,
  to: string,
): { start: string; end: string } | null {
  const start = rule.validFrom && Date.parse(rule.validFrom) > Date.parse(from) ? rule.validFrom : from;
  const end = rule.validTo && Date.parse(rule.validTo) < Date.parse(to) ? rule.validTo : to;
  return Date.parse(start) < Date.parse(end) ? { start, end } : null;
}

/**
 * `docs/design/06` "The availability endpoint" — the read side of the
 * availability engine: base weekly rules (`AvailabilityRuleRepository`),
 * minus `BLACKOUT`/plus `EXTRA` exceptions, minus blocking reservations,
 * capped at a 90-day window and cached per `(merchantId, resourceId, from,
 * to)` via `AvailabilityCache`. Only ever hands back bare `Interval`s (via
 * `computeFreeIntervals`) — it has no way to leak who booked a slot because
 * it never asks `ReservationRepository.findBlocking` for anything but
 * `startsAt`/`endsAt`.
 */
export class AvailabilityService {
  constructor(
    private readonly resources: ResourceRepository,
    private readonly locations: LocationRepository,
    private readonly rules: AvailabilityRuleRepository,
    private readonly exceptions: AvailabilityExceptionRepository,
    private readonly reservations: ReservationRepository,
    private readonly cache: AvailabilityCache,
  ) {}

  getResourceAvailability(
    ctx: TenantContext,
    resourceId: string,
    from: string,
    to: string,
    asOf: string,
  ): Interval[] {
    if (Date.parse(from) >= Date.parse(to)) {
      throw new Error(`from must be strictly before to, got from=${from} to=${to}`);
    }
    if (Date.parse(to) - Date.parse(from) > NINETY_DAYS_MS) {
      throw new AvailabilityRangeTooLargeError(from, to);
    }

    const cached = this.cache.get(ctx.merchantId, resourceId, from, to);
    if (cached) {
      return cached;
    }

    const resource = this.resources.findById(ctx, resourceId);
    if (!resource || resource.archivedAt) {
      throw new ResourceNotFoundError(resourceId);
    }
    const location = this.locations.findById(ctx, resource.locationId);
    if (!location) {
      throw new ResourceNotFoundError(resourceId);
    }

    const ruleRows = this.rules.listByResource(ctx, resourceId);
    const baseIntervals = ruleRows.flatMap((rule) => {
      const window = clampToRuleValidity(rule, from, to);
      if (!window) {
        return [];
      }
      const domainRule: DomainAvailabilityRule = {
        weekday: rule.weekday,
        startTime: rule.startTime,
        endTime: rule.endTime,
        timezone: location.timezone,
      };
      return expandAvailabilityRule(domainRule, window.start, window.end);
    });

    const exceptionRows = this.exceptions.listByResource(ctx, resourceId);
    const domainExceptions: DomainAvailabilityException[] = exceptionRows.map((exception) => ({
      kind: exception.kind,
      interval: makeInterval(exception.startsAt, exception.endsAt),
    }));

    const blockingRows = this.reservations.findBlocking(ctx, "RESOURCE", resourceId, from, to, asOf);
    const blockingIntervals = blockingRows.map((row) => makeInterval(row.startsAt, row.endsAt));

    const free = computeFreeIntervals(baseIntervals, domainExceptions, blockingIntervals);
    this.cache.set(ctx.merchantId, resourceId, from, to, free);
    return free;
  }
}
