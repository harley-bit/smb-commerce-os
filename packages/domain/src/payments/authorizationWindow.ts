/**
 * Authorization window ceiling — `docs/design/05`'s C4 rule: "The 30-day
 * ceiling is a product constraint. Standard authorization holds release
 * after ~7 days; lodging and vehicle-rental MCCs reach 30–31 days. Rentals
 * longer than the provider's window cannot rely on a hold and require a
 * captured deposit or a contractual claims process. Surface this in the
 * merchant UI when a rental period is configured beyond the ceiling — do
 * not discover it in production." Same risk as T11 in `docs/design/14`.
 *
 * Pure domain math, no I/O — same shape as `depositStateMachine.ts`.
 * `recordProviderAuthorizationWindow` is the only way to produce a
 * `ProviderAuthorizationWindow`, so a window can never be recorded above
 * the hard 30-day product ceiling. `validateRentalTermAgainstAuthorizationWindow`
 * is the only way to check a rental term against it, and throws — with
 * guidance a merchant UI can surface directly — rather than returning a
 * boolean a caller could silently ignore.
 */

export const AUTHORIZATION_WINDOW_CEILING_DAYS = 30;

export interface ProviderAuthorizationWindow {
  readonly providerWindowDays: number;
}

export class InvalidAuthorizationWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAuthorizationWindowError";
  }
}

export class RentalTermExceedsAuthorizationWindowError extends Error {
  constructor(
    public readonly rentalTermDays: number,
    public readonly window: ProviderAuthorizationWindow,
  ) {
    super(
      `Rental term of ${rentalTermDays} day(s) exceeds this payment provider's ` +
        `${window.providerWindowDays}-day authorization hold window. A hold cannot ` +
        `cover this rental — use a captured deposit up front or a contractual ` +
        `claims process instead.`,
    );
    this.name = "RentalTermExceedsAuthorizationWindowError";
  }
}

/**
 * Records a provider's authorization window in days. Rejects anything that
 * is not a positive integer, and rejects any window above the 30-day
 * product ceiling even if a provider claims to support longer — the
 * ceiling is a hard product constraint, not a pass-through of provider
 * data.
 */
export function recordProviderAuthorizationWindow(
  providerWindowDays: number,
): ProviderAuthorizationWindow {
  if (!Number.isInteger(providerWindowDays) || providerWindowDays <= 0) {
    throw new InvalidAuthorizationWindowError(
      `Authorization window must be a positive integer number of days, got ${providerWindowDays}.`,
    );
  }
  if (providerWindowDays > AUTHORIZATION_WINDOW_CEILING_DAYS) {
    throw new InvalidAuthorizationWindowError(
      `Authorization window of ${providerWindowDays} day(s) exceeds the ` +
        `${AUTHORIZATION_WINDOW_CEILING_DAYS}-day product ceiling.`,
    );
  }
  return { providerWindowDays };
}

/**
 * Validates a rental term (in days) against a recorded provider
 * authorization window. Throws `RentalTermExceedsAuthorizationWindowError`
 * — with guidance meant to be surfaced verbatim in the merchant UI at
 * configuration time — for any term the window cannot cover, including a
 * non-positive term.
 */
export function validateRentalTermAgainstAuthorizationWindow(
  rentalTermDays: number,
  window: ProviderAuthorizationWindow,
): void {
  if (rentalTermDays <= 0 || rentalTermDays > window.providerWindowDays) {
    throw new RentalTermExceedsAuthorizationWindowError(rentalTermDays, window);
  }
}
