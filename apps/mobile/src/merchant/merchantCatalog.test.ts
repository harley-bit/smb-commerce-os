import { describe, expect, it } from "vitest";
import { groupListingsByMode, MODE_SECTIONS } from "./merchantCatalog.js";
import type { PublicListing } from "@smb-os/contracts";

function listing(overrides: Partial<PublicListing>): PublicListing {
  return {
    id: "listing-1",
    mode: "PRODUCT",
    name: "Trail bike",
    slug: "trail-bike",
    description: null,
    ...overrides,
  };
}

describe("groupListingsByMode — mixed catalog rendering (docs/cards/D140.md)", () => {
  it("buckets a mixed PRODUCT/SERVICE/RENTAL catalog into one section per mode", () => {
    const listings = [
      listing({ id: "p1", mode: "PRODUCT" }),
      listing({ id: "s1", mode: "SERVICE", slug: "tune-up" }),
      listing({ id: "r1", mode: "RENTAL", slug: "weekend-rental" }),
      listing({ id: "p2", mode: "PRODUCT", slug: "helmet" }),
    ];

    const grouped = groupListingsByMode(listings);

    expect(grouped).toEqual([
      { mode: "PRODUCT", heading: "Products", listings: [listings[0], listings[3]] },
      { mode: "SERVICE", heading: "Services", listings: [listings[1]] },
      { mode: "RENTAL", heading: "Rentals", listings: [listings[2]] },
    ]);
  });

  it("returns every mode section, empty, when the catalog has no listings", () => {
    const grouped = groupListingsByMode([]);

    expect(grouped.map((section) => section.mode)).toEqual(MODE_SECTIONS.map((section) => section.mode));
    expect(grouped.every((section) => section.listings.length === 0)).toBe(true);
  });
});
