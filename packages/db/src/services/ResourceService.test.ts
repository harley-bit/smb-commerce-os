import { createTenantContext, generateUuidV7 } from "@smb-os/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "../connection.js";
import { runSqliteMigrations } from "../migrate.js";
import * as sqliteSchema from "../schema/sqlite.js";
import { AvailabilityExceptionRepository } from "../repositories/AvailabilityExceptionRepository.js";
import { AvailabilityRuleRepository } from "../repositories/AvailabilityRuleRepository.js";
import { ResourceRepository } from "../repositories/ResourceRepository.js";
import { ListingResourceRepository } from "../repositories/ListingResourceRepository.js";
import { ListingRepository } from "../repositories/ListingRepository.js";
import { CrossTenantResourceAssignmentError, ResourceService } from "./ResourceService.js";

describe("ResourceService", () => {
  let connection: Connection;
  let service: ResourceService;
  let listings: ListingRepository;
  let merchantA: string;
  let merchantB: string;
  let locationA: string;
  let locationB: string;

  beforeEach(async () => {
    connection = createConnection(":memory:");
    await runSqliteMigrations(connection);
    listings = new ListingRepository(connection);
    service = new ResourceService(
      new ResourceRepository(connection),
      new AvailabilityRuleRepository(connection),
      new AvailabilityExceptionRepository(connection),
      new ListingResourceRepository(connection),
      listings,
    );

    merchantA = generateUuidV7();
    merchantB = generateUuidV7();
    locationA = generateUuidV7();
    locationB = generateUuidV7();

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

    await connection.db.insert(sqliteSchema.locations).values([
      { id: locationA, merchantId: merchantA, name: "A Shop", timezone: "America/Los_Angeles" },
      { id: locationB, merchantId: merchantB, name: "B Shop", timezone: "America/New_York" },
    ]);
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

  describe("assignListingResource() — this card's security check: respects tenant scope", () => {
    it("assigns a resource to a listing for OWNER/ADMIN", () => {
      const ctx = createTenantContext(merchantA);
      const listingId = listings.create(ctx, {
        mode: "SERVICE",
        name: "Haircut",
        slug: "haircut",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      });
      const resourceId = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "STAFF",
        name: "Jamie Rivera",
        capacity: 1,
      });

      const id = service.assignListingResource(ctx, "OWNER", {
        listingId,
        resourceId,
        createdAt: "2026-09-08T00:00:00.000Z",
      });

      expect(service.listListingResources(ctx, listingId).map((r) => r.id)).toEqual([id]);
    });

    it("throws for STAFF/READ_ONLY", () => {
      const ctx = createTenantContext(merchantA);
      const listingId = listings.create(ctx, {
        mode: "SERVICE",
        name: "Haircut",
        slug: "haircut",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      });
      const resourceId = service.createResource(ctx, "OWNER", {
        locationId: locationA,
        kind: "STAFF",
        name: "Jamie Rivera",
        capacity: 1,
      });

      for (const role of ["STAFF", "READ_ONLY"] as const) {
        expect(() =>
          service.assignListingResource(ctx, role, {
            listingId,
            resourceId,
            createdAt: "2026-09-08T00:00:00.000Z",
          }),
        ).toThrow(/restricted to OWNER or ADMIN/);
      }
      expect(service.listListingResources(ctx, listingId)).toHaveLength(0);
    });

    it("rejects assigning merchant B's resource to merchant A's listing — no cross-tenant assignment", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);

      const listingIdA = listings.create(ctxA, {
        mode: "SERVICE",
        name: "Haircut",
        slug: "haircut",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      });
      const resourceIdB = service.createResource(ctxB, "OWNER", {
        locationId: locationB,
        kind: "STAFF",
        name: "Riley",
        capacity: 1,
      });

      expect(() =>
        service.assignListingResource(ctxA, "OWNER", {
          listingId: listingIdA,
          resourceId: resourceIdB,
          createdAt: "2026-09-08T00:00:00.000Z",
        }),
      ).toThrow(CrossTenantResourceAssignmentError);
      expect(service.listListingResources(ctxA, listingIdA)).toHaveLength(0);
    });

    it("rejects assigning merchant A's resource to merchant B's listing — no cross-tenant assignment", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);

      const listingIdB = listings.create(ctxB, {
        mode: "SERVICE",
        name: "Massage",
        slug: "massage",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      });
      const resourceIdA = service.createResource(ctxA, "OWNER", {
        locationId: locationA,
        kind: "STAFF",
        name: "Jamie Rivera",
        capacity: 1,
      });

      expect(() =>
        service.assignListingResource(ctxB, "OWNER", {
          listingId: listingIdB,
          resourceId: resourceIdA,
          createdAt: "2026-09-08T00:00:00.000Z",
        }),
      ).toThrow(CrossTenantResourceAssignmentError);
    });

    it("removeListingResource() cannot remove another merchant's assignment", () => {
      const ctxA = createTenantContext(merchantA);
      const ctxB = createTenantContext(merchantB);

      const listingIdA = listings.create(ctxA, {
        mode: "SERVICE",
        name: "Haircut",
        slug: "haircut",
        status: "DRAFT",
        createdAt: "2026-09-08T00:00:00.000Z",
      });
      const resourceIdA = service.createResource(ctxA, "OWNER", {
        locationId: locationA,
        kind: "STAFF",
        name: "Jamie Rivera",
        capacity: 1,
      });
      const assignmentId = service.assignListingResource(ctxA, "OWNER", {
        listingId: listingIdA,
        resourceId: resourceIdA,
        createdAt: "2026-09-08T00:00:00.000Z",
      });

      service.removeListingResource(ctxB, "OWNER", assignmentId);

      expect(service.listListingResources(ctxA, listingIdA).map((r) => r.id)).toEqual([assignmentId]);
    });
  });
});
