import type { ActorRoleView } from "@bthwani/identity";

type CustomerState = Pick<ActorRoleView, "enabled" | "securityEnabled">;

export function customerStateLabel(customer: CustomerState): string {
  return !customer.securityEnabled ? "محظور أمنيًا" : !customer.enabled ? "موقوف" : "نشط";
}

// These counts apply ONLY to visible rows on the current Identity page.
// The paginated Identity API does not supply an all-customers total.
export function customerPageCounts(customers: readonly CustomerState[]) {
  const counts = { total: customers.length, active: 0, suspended: 0, blocked: 0 };
  for (const customer of customers) {
    if (!customer.securityEnabled) counts.blocked += 1;
    else if (!customer.enabled) counts.suspended += 1;
    else counts.active += 1;
  }
  return counts;
}
