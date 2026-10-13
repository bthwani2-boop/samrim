import type { StoreAccessPermission } from "@bthwani/dsh";

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
