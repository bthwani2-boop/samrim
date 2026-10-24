import type { CustomerFulfillmentMode } from "@bthwani/dsh";

const MODES: ReadonlyArray<CustomerFulfillmentMode> = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];

export function resolveFulfillmentChoice(
  available: ReadonlyArray<CustomerFulfillmentMode>,
  requested: string | null | undefined,
  saved: string | null | undefined,
): CustomerFulfillmentMode | null {
  if (available.length === 0) return null;
  if (available.length === 1) return available[0] ?? null;
  if (requested && MODES.includes(requested as CustomerFulfillmentMode) && available.includes(requested as CustomerFulfillmentMode)) return requested as CustomerFulfillmentMode;
  if (saved && MODES.includes(saved as CustomerFulfillmentMode) && available.includes(saved as CustomerFulfillmentMode)) return saved as CustomerFulfillmentMode;
  return null;
}
