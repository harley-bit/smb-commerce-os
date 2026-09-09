import { z } from "zod";

/**
 * The wire contract for `POST /merchants` (D103 — merchant onboarding).
 * `legalName`, `taxId`, and the business address are required, not
 * optional: `docs/design/08` line 11 and line 84 make seller-identity
 * capture at onboarding a deliberate design decision (DAC7/DSA
 * readiness), not a nice-to-have, so the contract enforces it at the
 * boundary rather than leaving it to a UI convention that can be skipped.
 */
export const onboardMerchantInputSchema = z.object({
  businessName: z.string().min(1),
  slug: z.string().min(1).optional(),
  defaultCurrency: z.string().min(1),
  legalName: z.string().min(1),
  taxId: z.string().min(1),
  businessAddress: z.object({
    addressLine1: z.string().min(1),
    addressLine2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().optional(),
    postalCode: z.string().min(1),
    country: z.string().min(1),
  }),
  location: z.object({
    name: z.string().min(1),
    timezone: z.string().min(1),
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().optional(),
  }),
});
export type OnboardMerchantInput = z.infer<typeof onboardMerchantInputSchema>;

export const onboardMerchantResultSchema = z.object({
  merchantId: z.string().min(1),
  slug: z.string().min(1),
  locationId: z.string().min(1),
});
export type OnboardMerchantResult = z.infer<typeof onboardMerchantResultSchema>;
