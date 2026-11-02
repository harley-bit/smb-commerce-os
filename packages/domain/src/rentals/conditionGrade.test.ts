import { describe, expect, it } from "vitest";
import {
  CONDITION_GRADES,
  InvalidConditionGradeError,
  compareConditionGrades,
  computeConditionGradeDelta,
} from "./conditionGrade.js";

describe("condition grade scale", () => {
  it("orders grades from worst (DAMAGED) to best (NEW)", () => {
    expect(CONDITION_GRADES).toEqual(["DAMAGED", "POOR", "FAIR", "GOOD", "EXCELLENT", "NEW"]);
  });

  it("compareConditionGrades() is positive when the first grade is better", () => {
    expect(compareConditionGrades("NEW", "POOR")).toBeGreaterThan(0);
    expect(compareConditionGrades("POOR", "NEW")).toBeLessThan(0);
    expect(compareConditionGrades("GOOD", "GOOD")).toBe(0);
  });
});

describe("computeConditionGradeDelta()", () => {
  it("reports deterioration when checkin grade is worse than checkout", () => {
    const delta = computeConditionGradeDelta("GOOD", "FAIR");

    expect(delta).toEqual({
      checkoutGrade: "GOOD",
      checkinGrade: "FAIR",
      deltaSteps: -1,
      deteriorated: true,
      improved: false,
      unchanged: false,
    });
  });

  it("reports improvement when checkin grade is better than checkout", () => {
    const delta = computeConditionGradeDelta("FAIR", "EXCELLENT");

    expect(delta).toEqual({
      checkoutGrade: "FAIR",
      checkinGrade: "EXCELLENT",
      deltaSteps: 2,
      deteriorated: false,
      improved: true,
      unchanged: false,
    });
  });

  it("reports unchanged when both grades match", () => {
    const delta = computeConditionGradeDelta("GOOD", "GOOD");

    expect(delta).toMatchObject({ deltaSteps: 0, deteriorated: false, improved: false, unchanged: true });
  });

  it("rejects a grade outside the known scale on either side", () => {
    expect(() => computeConditionGradeDelta("PRISTINE", "GOOD")).toThrow(InvalidConditionGradeError);
    expect(() => computeConditionGradeDelta("GOOD", "PRISTINE")).toThrow(InvalidConditionGradeError);
  });
});
