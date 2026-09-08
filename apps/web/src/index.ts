import { contractsPackageMarker, createListingInputSchema, type CreateListingInput } from "@smb-os/contracts";

export function webAppMarker(): string {
  return `@smb-os/web -> ${contractsPackageMarker()}`;
}

/**
 * Proves this app compiles against `@smb-os/contracts`' generated types and
 * validates against its generated Zod schema, not just declares the
 * workspace dependency (`D034`'s acceptance criterion). Real catalog forms
 * land in a later Phase 2 card; this is the compile/parse smoke test.
 */
export function parseListingDraft(input: unknown): CreateListingInput {
  return createListingInputSchema.parse(input);
}
