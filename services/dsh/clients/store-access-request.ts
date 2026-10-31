import type { StoreAccessInvitationCreateRequest, StoreAccessPermission } from "./generated/dsh-types";

const ALLOWED_STORE_ACCESS_PERMISSIONS: ReadonlySet<StoreAccessPermission> = new Set([
  "orders", "catalog", "store_operations", "promotions", "finance_read", "payout_request", "fulfillment",
]);

export function validStoreAccessPermissionSet(permissions: ReadonlyArray<StoreAccessPermission>): boolean {
  return permissions.length > 0 && permissions.length <= ALLOWED_STORE_ACCESS_PERMISSIONS.size &&
    new Set(permissions).size === permissions.length &&
    permissions.every(permission => ALLOWED_STORE_ACCESS_PERMISSIONS.has(permission)) &&
    (!permissions.includes("fulfillment") || permissions.includes("orders"));
}

export function normalizeStoreAccessInvitationInput(input: StoreAccessInvitationCreateRequest): StoreAccessInvitationCreateRequest {
  const delegatePhoneE164 = input.delegatePhoneE164.trim();
  const displayNameAr = input.displayNameAr?.trim() ?? "";
  if (delegatePhoneE164.length < 8 || delegatePhoneE164.length > 24 ||
    Array.from(displayNameAr).length > 80 || !validStoreAccessPermissionSet(input.permissions)) {
    throw new Error("DSH_STORE_ACCESS_INVITATION_INPUT_INVALID");
  }
  return { delegatePhoneE164, ...(displayNameAr ? { displayNameAr } : {}), permissions: [...input.permissions] };
}
