import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { AvailabilityExceptionRepository } from "../repositories/AvailabilityExceptionRepository.js";
import { AvailabilityRuleRepository } from "../repositories/AvailabilityRuleRepository.js";
import { ResourceRepository } from "../repositories/ResourceRepository.js";
import { ResourceService } from "./ResourceService.js";

describe("ResourceService", () => {
  let connection: Connection;
  let service: ResourceService;
  let merchantA: string;
  let locationA: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    service = new ResourceService(
      new ResourceRepository(connection),
      new AvailabilityRuleRepository(connection),
      new AvailabilityExceptionRepository(connection),
    );

    merchantA = generateUuidV7();
    locationA = generateUuidV7();

    await connection.db.insert(sqliteSchema.merchants).values({
      id: merchantA,
      name: "Merchant A",
      slug: "merchant-a",
      status: "ACTIVE",
      defaultCurrency: "USD",
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    await connection.db.insert(sqliteSchema.locations).values({
      id: locationA,
      merchantId: merchantA,
      name: "A Shop",
      timezone: "America/Los_Angeles",
    });
  });

  describe("authorization — resource management restricted to OWNER/ADMIN", () => {
    const rolesAllowed = ["OWNER", "ADMIN"] as const;
    const rolesDenied = ["STAFF", "READ_ONLY"] as const;

    it.each(rolesAllowed)("createResource() succeeds for %s", (role) => {
      const ctx = createTenantContext(merchantA);
      expect(() =>
        service.createResource(ctx, role, {
          locationId: locationA,
          kind: "STAFF",
          name: "Jamie Rivera",
          capacity: 1,
        }),
      ).not.toThrow();
    });

    it.each(rolesDenied)("createResource() throws for %s", (role) => {
      const ctx = createTenantContext(merchantA);
      expect(() =>
        service.createResource(ctx, role, {
          locationId: locationA,
          kind: "STAFF",
          name: "Jamie Rivera",
          capacity: 1,
        }),
      ).toThrow(/restricted to OWNER or ADMIN/);
    });

    it("updateResource() throws for STAFF", () => {
      const ctx = createTenantContext(merchantA);
      const id = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "ROOM",
        name: "Room 1",
        capacity: 4,
      });

      expect(() => service.updateResource(ctx, "STAFF", id, { name: "Hijacked" })).toThrow(
        /restricted to OWNER or ADMIN/,
      );
      expect(service.findResourceById(ctx, id)?.name).toBe("Room 1");
    });

    it("archiveResource() throws for READ_ONLY", () => {
      const ctx = createTenantContext(merchantA);
      const id = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "ROOM",
        name: "Room 1",
        capacity: 4,
      });

      expect(() => service.archiveResource(ctx, "READ_ONLY", id, "2026-09-09T00:00:00.000Z")).toThrow(
        /restricted to OWNER or ADMIN/,
      );
      expect(service.findResourceById(ctx, id)?.archivedAt).toBeNull();
    });

    it("createAvailabilityRule() throws for STAFF, succeeds for ADMIN", () => {
      const ctx = createTenantContext(merchantA);
      const resourceId = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "ROOM",
        name: "Room 1",
        capacity: 4,
      });

      expect(() =>
        service.createAvailabilityRule(ctx, "STAFF", {
          resourceId,
          weekday: 1,
          startTime: "09:00",
          endTime: "17:00",
        }),
      ).toThrow(/restricted to OWNER or ADMIN/);

      expect(() =>
        service.createAvailabilityRule(ctx, "ADMIN", {
          resourceId,
          weekday: 1,
          startTime: "09:00",
          endTime: "17:00",
        }),
      ).not.toThrow();
    });

    it("removeAvailabilityRule() throws for READ_ONLY", () => {
      const ctx = createTenantContext(merchantA);
      const resourceId = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "ROOM",
        name: "Room 1",
        capacity: 4,
      });
      const ruleId = service.createAvailabilityRule(ctx, "OWNER", {
        resourceId,
        weekday: 1,
        startTime: "09:00",
        endTime: "17:00",
      });

      expect(() => service.removeAvailabilityRule(ctx, "READ_ONLY", ruleId)).toThrow(
        /restricted to OWNER or ADMIN/,
      );
    });

    it("createAvailabilityException() throws for STAFF, succeeds for OWNER", () => {
      const ctx = createTenantContext(merchantA);
      const resourceId = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "ROOM",
        name: "Room 1",
        capacity: 4,
      });

      expect(() =>
        service.createAvailabilityException(ctx, "STAFF", {
          resourceId,
          startsAt: "2026-12-25T00:00:00.000Z",
          endsAt: "2026-12-26T00:00:00.000Z",
          kind: "BLACKOUT",
        }),
      ).toThrow(/restricted to OWNER or ADMIN/);

      expect(() =>
        service.createAvailabilityException(ctx, "OWNER", {
          resourceId,
          startsAt: "2026-12-25T00:00:00.000Z",
          endsAt: "2026-12-26T00:00:00.000Z",
          kind: "BLACKOUT",
        }),
      ).not.toThrow();
    });

    it("updateAvailabilityException() throws for STAFF", () => {
      const ctx = createTenantContext(merchantA);
      const resourceId = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "ROOM",
        name: "Room 1",
        capacity: 4,
      });
      const exceptionId = service.createAvailabilityException(ctx, "OWNER", {
        resourceId,
        startsAt: "2026-12-25T00:00:00.000Z",
        endsAt: "2026-12-26T00:00:00.000Z",
        kind: "BLACKOUT",
      });

      expect(() =>
        service.updateAvailabilityException(ctx, "STAFF", exceptionId, { kind: "EXTRA" }),
      ).toThrow(/restricted to OWNER or ADMIN/);
    });

    it("removeAvailabilityException() throws for READ_ONLY", () => {
      const ctx = createTenantContext(merchantA);
      const resourceId = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "ROOM",
        name: "Room 1",
        capacity: 4,
      });
      const exceptionId = service.createAvailabilityException(ctx, "OWNER", {
        resourceId,
        startsAt: "2026-12-25T00:00:00.000Z",
        endsAt: "2026-12-26T00:00:00.000Z",
        kind: "BLACKOUT",
      });

      expect(() => service.removeAvailabilityException(ctx, "READ_ONLY", exceptionId)).toThrow(
        /restricted to OWNER or ADMIN/,
      );
    });
  });

  describe("reads are unrestricted by role", () => {
    it("listResources()/listAvailabilityRules()/listAvailabilityExceptions() work for READ_ONLY", () => {
      const ctx = createTenantContext(merchantA);
      const resourceId = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "ROOM",
        name: "Room 1",
        capacity: 4,
      });
      service.createAvailabilityRule(ctx, "OWNER", {
        resourceId,
        weekday: 1,
        startTime: "09:00",
        endTime: "17:00",
      });
      service.createAvailabilityException(ctx, "OWNER", {
        resourceId,
        startsAt: "2026-12-25T00:00:00.000Z",
        endsAt: "2026-12-26T00:00:00.000Z",
        kind: "BLACKOUT",
      });

      expect(service.listResources(ctx)).toHaveLength(1);
      expect(service.listAvailabilityRules(ctx, resourceId)).toHaveLength(1);
      expect(service.listAvailabilityExceptions(ctx, resourceId)).toHaveLength(1);
    });
  });
});
