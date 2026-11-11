import type { StoreFulfillmentMode, StoreJoiningOption } from "@bthwani/dsh";

/** Enrollment visibility is a DSH readback; this check never grants Store publication. */
export function firstStoreRelationCanEnroll(
  policies: ReadonlyArray<StoreJoiningOption>,
  relation: FirstStoreRelation | "",
): boolean {
  if (relation !== "BTHWANI_PARTNER" && relation !== "INDEPENDENT_STORE") return false;
  return policies.some(policy => policy.relationModel === relation && policy.enrollmentEnabled === true);
}

export type FirstStoreRelation = "BTHWANI_PARTNER" | "INDEPENDENT_STORE";

/** Keep deliberate fulfillment choices when an already-selected relation is tapped again. */
export function firstStoreModesForRelation(
  previous: FirstStoreRelation | "",
  selected: FirstStoreRelation,
  modes: ReadonlyArray<StoreFulfillmentMode>,
): StoreFulfillmentMode[] {
  if (selected !== "BTHWANI_PARTNER" && selected !== "INDEPENDENT_STORE") return [];
  if (previous === selected) {
    // Keep valid deliberate modes, but never preserve marketplace Captain for an independent Store.
    return modes.filter(mode => mode === "CUSTOMER_PICKUP" || mode === "PARTNER_CAPTAIN" ||
      (selected === "BTHWANI_PARTNER" && mode === "BTHWANI_CAPTAIN"));
  }
  return selected === "INDEPENDENT_STORE" ? ["CUSTOMER_PICKUP"] : ["BTHWANI_CAPTAIN"];
}

export function firstStoreFulfillmentLabel(mode: StoreFulfillmentMode): string {
  switch (mode) {
    case "BTHWANI_CAPTAIN": return "توصيل بثواني";
    case "PARTNER_CAPTAIN": return "مندوب المتجر";
    case "CUSTOMER_PICKUP": return "استلام من المتجر";
  }
}
