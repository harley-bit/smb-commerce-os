import { isUuidV7 } from "../utils/uuid.js";

/**
 * The tenant scope a repository call is permitted to touch — `merchant_id`
 * and nothing else. Deliberately distinct from `AuthIdentity`
 * (`packages/domain/src/auth`): that answers "who is calling," this
 * answers "which merchant's rows may they see." Control #1 layer 2
 * (`docs/design/07`) requires every repository method to take this as its
 * first parameter, so a missing scope is a compile error, not a runtime
 * check that can be forgotten.
 */
export interface TenantContext {
  readonly merchantId: string;
}

/**
 * The only way to produce a `TenantContext` — rejects anything that isn't
 * a real UUIDv7 merchant id, so an empty string or a stray user id can't
 * silently become a tenant scope.
 */
export function createTenantContext(merchantId: string): TenantContext {
  if (!isUuidV7(merchantId)) {
    throw new Error(`TenantContext requires a UUIDv7 merchantId, got: ${JSON.stringify(merchantId)}`);
  }
  return { merchantId };
}
