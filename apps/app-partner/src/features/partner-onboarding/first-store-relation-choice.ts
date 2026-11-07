import type { StoreFulfillmentMode } from "@bthwani/dsh";

export type FirstStoreRelation = "BTHWANI_PARTNER" | "INDEPENDENT_STORE";

/** Keep deliberate fulfillment choices when an already-selected relation is tapped again. */
export function firstStoreModesForRelation(
  previous: FirstStoreRelation | "",
  selected: FirstStoreRelation,
  modes: ReadonlyArray<StoreFulfillmentMode>,
): StoreFulfillmentMode[] {
  if (previous === selected) return [...modes];
  return selected === "INDEPENDENT_STORE" ? ["CUSTOMER_PICKUP"] : ["BTHWANI_CAPTAIN"];
}

export function firstStoreFulfillmentLabel(mode: StoreFulfillmentMode): string {
  switch (mode) {
    case "BTHWANI_CAPTAIN": return "توصيل بثواني";
    case "PARTNER_CAPTAIN": return "مندوب المتجر";
    case "CUSTOMER_PICKUP": return "استلام من المتجر";
  }
}
