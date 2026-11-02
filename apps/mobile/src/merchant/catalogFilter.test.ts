import { describe, expect, it } from "vitest";
import { CATALOG_FILTERS, filterToMode } from "./catalogFilter.js";

describe("catalogFilter — D141's browse filter tabs", () => {
  it("lists ALL first, then PRODUCT/SERVICE/RENTAL in that order", () => {
    expect(CATALOG_FILTERS.map((f) => f.filter)).toEqual(["ALL", "PRODUCT", "SERVICE", "RENTAL"]);
  });

  it("filterToMode(\"ALL\") is undefined — no mode filter sent to the server", () => {
    expect(filterToMode("ALL")).toBeUndefined();
  });

  it("filterToMode(mode) passes a specific mode straight through", () => {
    expect(filterToMode("PRODUCT")).toBe("PRODUCT");
    expect(filterToMode("SERVICE")).toBe("SERVICE");
    expect(filterToMode("RENTAL")).toBe("RENTAL");
  });
});
