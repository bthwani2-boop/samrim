import type { StoreAccessGrant, StoreAccessPermission } from "@bthwani/dsh";

// Fulfillment is scoped to order access. Remove both together rather than
// leaving a silent invalid grant or accidentally widening a delegated role.
export function toggleStoreAccessPermission(
  current: ReadonlyArray<StoreAccessPermission>,
  permission: StoreAccessPermission,
): StoreAccessPermission[] {
  if (current.includes(permission)) {
    return current.filter((item) => item !== permission && !(permission === "orders" && item === "fulfillment"));
  }
  return permission === "fulfillment"
    ? [...new Set<StoreAccessPermission>([...current, "orders", "fulfillment"])]
    : [...current, permission];
}

// Preserve the same DSH mutation identity when a network failure hides a
// committed permissions update. Different facts/version get another key.
export function storeAccessPermissionsMutationIdentity(
  storeID: string,
  grantID: string,
  expectedVersion: number,
  next: ReadonlyArray<StoreAccessPermission>,
): string {
  return JSON.stringify([storeID, grantID, expectedVersion, [...next].sort()]);
}

export function storeAccessPermissionsReadbackConfirmed(
  previous: Pick<StoreAccessGrant, "id" | "storeId" | "ownerPartnerActorId" | "delegateActorId" | "version">,
  canonical: StoreAccessGrant | undefined,
  next: ReadonlyArray<StoreAccessPermission>,
): boolean {
  return Boolean(canonical && canonical.id === previous.id && canonical.storeId === previous.storeId &&
    canonical.ownerPartnerActorId === previous.ownerPartnerActorId &&
    canonical.delegateActorId === previous.delegateActorId &&
    canonical.version > previous.version &&
    next.length > 0 &&
    [...canonical.permissions].sort().join("|") === [...next].sort().join("|"));
}
