import { describe, expect, it } from "vitest";
import {
  assignListingResourceInputSchema,
  availabilityExceptionSchema,
  availabilityRuleSchema,
  createAvailabilityExceptionInputSchema,
  createAvailabilityRuleInputSchema,
  createResourceInputSchema,
  listingResourceAssignmentSchema,
  resourceSchema,
  updateAvailabilityExceptionInputSchema,
  updateAvailabilityRuleInputSchema,
  updateResourceInputSchema,
} from "./resource.js";

const validResource = {
  id: "01977e6a-0000-7000-8000-000000000000",
  merchantId: "01977e6a-0000-7000-8000-000000000001",
  locationId: "01977e6a-0000-7000-8000-000000000002",
  kind: "STAFF" as const,
  name: "Jamie Rivera",
  capacity: 1,
  archivedAt: null,
};

describe("resourceSchema", () => {
  it("accepts a well-formed resource row", () => {
    expect(resourceSchema.parse(validResource)).toEqual(validResource);
  });

  it("rejects an unknown kind", () => {
    expect(() => resourceSchema.parse({ ...validResource, kind: "VEHICLE" })).toThrow();
  });

  it("rejects a non-positive capacity", () => {
    expect(() => resourceSchema.parse({ ...validResource, capacity: 0 })).toThrow();
  });
});

describe("createResourceInputSchema", () => {
  it("accepts a valid create payload", () => {
    const input = {
      locationId: validResource.locationId,
      kind: "ROOM" as const,
      name: "Studio A",
      capacity: 4,
    };
    expect(createResourceInputSchema.parse(input)).toEqual(input);
  });
});

describe("updateResourceInputSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateResourceInputSchema.parse({})).toEqual({});
  });

  it("rejects an unknown key", () => {
    expect(() => updateResourceInputSchema.parse({ kind: "ROOM" })).toThrow();
  });
});

const validRule = {
  id: "01977e6a-0000-7000-8000-000000000003",
  merchantId: "01977e6a-0000-7000-8000-000000000001",
  resourceId: "01977e6a-0000-7000-8000-000000000000",
  weekday: 1,
  startTime: "09:00",
  endTime: "17:00",
  validFrom: null,
  validTo: null,
};

describe("availabilityRuleSchema", () => {
  it("accepts a well-formed rule row", () => {
    expect(availabilityRuleSchema.parse(validRule)).toEqual(validRule);
  });

  it("rejects a weekday out of range", () => {
    expect(() => availabilityRuleSchema.parse({ ...validRule, weekday: 7 })).toThrow();
  });

  it("rejects a malformed time-of-day", () => {
    expect(() => availabilityRuleSchema.parse({ ...validRule, startTime: "9am" })).toThrow();
  });
});

describe("createAvailabilityRuleInputSchema", () => {
  it("accepts a valid create payload", () => {
    const input = {
      resourceId: validRule.resourceId,
      weekday: 2,
      startTime: "08:00",
      endTime: "16:00",
    };
    expect(createAvailabilityRuleInputSchema.parse(input)).toEqual(input);
  });
});

describe("updateAvailabilityRuleInputSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateAvailabilityRuleInputSchema.parse({})).toEqual({});
  });

  it("rejects an unknown key", () => {
    expect(() => updateAvailabilityRuleInputSchema.parse({ resourceId: "x" })).toThrow();
  });
});

const validException = {
  id: "01977e6a-0000-7000-8000-000000000004",
  merchantId: "01977e6a-0000-7000-8000-000000000001",
  resourceId: "01977e6a-0000-7000-8000-000000000000",
  startsAt: "2026-12-25T00:00:00.000Z",
  endsAt: "2026-12-26T00:00:00.000Z",
  kind: "BLACKOUT" as const,
  note: null,
};

describe("availabilityExceptionSchema", () => {
  it("accepts a well-formed exception row", () => {
    expect(availabilityExceptionSchema.parse(validException)).toEqual(validException);
  });

  it("rejects an unknown kind", () => {
    expect(() => availabilityExceptionSchema.parse({ ...validException, kind: "HOLD" })).toThrow();
  });
});

describe("createAvailabilityExceptionInputSchema", () => {
  it("accepts a valid create payload", () => {
    const input = {
      resourceId: validException.resourceId,
      startsAt: validException.startsAt,
      endsAt: validException.endsAt,
      kind: "EXTRA" as const,
    };
    expect(createAvailabilityExceptionInputSchema.parse(input)).toEqual(input);
  });
});

describe("updateAvailabilityExceptionInputSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateAvailabilityExceptionInputSchema.parse({})).toEqual({});
  });

  it("rejects an unknown key", () => {
    expect(() => updateAvailabilityExceptionInputSchema.parse({ resourceId: "x" })).toThrow();
  });
});

describe("listingResourceAssignmentSchema", () => {
  const validAssignment = {
    id: "01977e6a-0000-7000-8000-000000000010",
    merchantId: "01977e6a-0000-7000-8000-000000000001",
    listingId: "01977e6a-0000-7000-8000-000000000011",
    resourceId: "01977e6a-0000-7000-8000-000000000000",
    createdAt: "2026-09-08T00:00:00.000Z",
  };

  it("accepts a well-formed assignment row", () => {
    expect(listingResourceAssignmentSchema.parse(validAssignment)).toEqual(validAssignment);
  });

  it("rejects a missing resourceId", () => {
    expect(() => listingResourceAssignmentSchema.parse({ ...validAssignment, resourceId: "" })).toThrow();
  });
});

describe("assignListingResourceInputSchema", () => {
  it("accepts a valid create payload", () => {
    const input = { resourceId: "01977e6a-0000-7000-8000-000000000000" };
    expect(assignListingResourceInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a missing resourceId", () => {
    expect(() => assignListingResourceInputSchema.parse({})).toThrow();
  });
});
