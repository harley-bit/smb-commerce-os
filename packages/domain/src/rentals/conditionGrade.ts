/**
 * `docs/design/03` "Rental lifecycle" / `docs/cards/D075.md` — a fixed,
 * ordered scale for `condition_reports.condition_grade` so a CHECKOUT and
 * CHECKIN grade for the same rental can be compared, not just displayed
 * side by side. Worst to best; index position is the ordinal used for
 * comparison, not the string itself.
 */
export const CONDITION_GRADES = ["DAMAGED", "POOR", "FAIR", "GOOD", "EXCELLENT", "NEW"] as const;

export type ConditionGrade = (typeof CONDITION_GRADES)[number];

export class InvalidConditionGradeError extends Error {
  constructor(public readonly grade: string) {
    super(`Not a recognized condition grade: ${grade}`);
    this.name = "InvalidConditionGradeError";
  }
}

function assertConditionGrade(grade: string): ConditionGrade {
  if (!(CONDITION_GRADES as readonly string[]).includes(grade)) {
    throw new InvalidConditionGradeError(grade);
  }
  return grade as ConditionGrade;
}

/** Positive when `a` is the better condition, negative when `b` is, zero when equal. */
export function compareConditionGrades(a: ConditionGrade, b: ConditionGrade): number {
  return CONDITION_GRADES.indexOf(a) - CONDITION_GRADES.indexOf(b);
}

export interface ConditionGradeDelta {
  checkoutGrade: ConditionGrade;
  checkinGrade: ConditionGrade;
  /** Steps on `CONDITION_GRADES` from checkout to checkin; negative = deterioration. */
  deltaSteps: number;
  deteriorated: boolean;
  improved: boolean;
  unchanged: boolean;
}

/**
 * `docs/cards/D075.md` acceptance criterion — the grade delta surfaced to
 * the merchant. Both grades are validated against the known scale before
 * comparison, since an unrecognized grade can't be positioned on it.
 */
export function computeConditionGradeDelta(
  checkoutGrade: string,
  checkinGrade: string,
): ConditionGradeDelta {
  const checkout = assertConditionGrade(checkoutGrade);
  const checkin = assertConditionGrade(checkinGrade);
  const deltaSteps = compareConditionGrades(checkin, checkout);

  return {
    checkoutGrade: checkout,
    checkinGrade: checkin,
    deltaSteps,
    deteriorated: deltaSteps < 0,
    improved: deltaSteps > 0,
    unchanged: deltaSteps === 0,
  };
}
