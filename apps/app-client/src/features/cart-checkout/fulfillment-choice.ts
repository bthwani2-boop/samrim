import type { CustomerFulfillmentMode } from "@bthwani/dsh";
import * as SecureStore from "../../bootstrap/compatible-storage";
import { currentIdentityState } from "../../bootstrap/identity";

import { resolveFulfillmentChoice } from "./fulfillment-choice-core";
export { resolveFulfillmentChoice } from "./fulfillment-choice-core";
const MODES: ReadonlyArray<CustomerFulfillmentMode> = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];

function preferenceKey(storeID: string, cityID: string): string | null {
  const session = currentIdentityState();
  if (session.kind !== "authenticated" || !storeID || !cityID) return null;
  return ["bthwani.client.fulfillment.v1", session.identity.subject.trim(), cityID, storeID]
    .map(encodeURIComponent).join(".");
}

export async function readSavedFulfillmentMode(
  storeID: string, cityID: string,
  available: ReadonlyArray<CustomerFulfillmentMode>,
): Promise<CustomerFulfillmentMode | null> {
  const key = preferenceKey(storeID, cityID);
  if (!key) return null;
  try { return resolveFulfillmentChoice(available, null, await SecureStore.getItemAsync(key)); }
  catch { return null; }
}

export async function saveFulfillmentMode(storeID: string, cityID: string, mode: CustomerFulfillmentMode): Promise<void> {
  const key = preferenceKey(storeID, cityID);
  if (!key || !MODES.includes(mode)) return;
  try { await SecureStore.setItemAsync(key, mode); }
  catch { /* A storage failure must not block checkout; the route still carries the chosen mode. */ }
}
