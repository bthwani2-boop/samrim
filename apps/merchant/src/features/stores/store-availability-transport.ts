import {
  confirmStoreOperationalResult, DshPublicError, getStoreOperationalAvailability,
  parseStoreOperationalAvailability, type StoreOperationalAvailability, type StoreOperationalChange,
  updateStoreOperationalAvailability, validStoreOperationalChange,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";
import { requestMerchantOwnerDocument } from "../access/merchant-owner-web.ts";

const availabilityByteLimit = 32 * 1024;

/** Read-only DSH projection, bound to the active Merchant context on Web. */
export async function readMerchantAvailability(storeId: string, signal: AbortSignal, actorId?: string): Promise<StoreOperationalAvailability> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId)) throw new DshPublicError(400, "STORE_ID_INVALID");
  if (signal.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      getStoreOperationalAvailability(origin, storeId, bearer, signal), actorId);
  }
  if (!actorId) throw new DshPublicError(403, "MERCHANT_CONTEXT_CHANGED");
  const { document } = await requestMerchantOwnerDocument({
    query: new URLSearchParams({ availability: storeId }), actorId, method: "GET", signal,
    byteLimit: availabilityByteLimit,
  });
  if (Object.keys(document).length !== 1 || !Object.hasOwn(document, "availability")) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return parseStoreOperationalAvailability(document.availability, storeId);
}

export async function saveMerchantAvailability(
  storeId: string, actorId: string, change: StoreOperationalChange, signal: AbortSignal,
): Promise<void> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId || !validStoreOperationalChange(change)) {
    throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  }
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    await withNativeMerchantSession(signal, (bearer, origin) =>
      updateStoreOperationalAvailability(origin, storeId, bearer, change, signal), actorId, true);
    return;
  }
  const { document } = await requestMerchantOwnerDocument({
    query: new URLSearchParams({ availability: storeId }), actorId, method: "PATCH", signal,
    change, byteLimit: availabilityByteLimit,
  });
  confirmStoreOperationalResult(document, storeId, change);
}
