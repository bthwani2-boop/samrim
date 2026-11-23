import { DshPublicError, getStoreOperationalAvailability, type StoreOperationalAvailability, type StoreOperationalChange, updateStoreOperationalAvailability } from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";

/** Read-only Store projection. Identity proves the role; DSH authorizes the Store. */
export async function readMerchantAvailability(storeId: string, signal: AbortSignal, actorId?: string): Promise<StoreOperationalAvailability> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId)) throw new DshPublicError(400, "STORE_ID_INVALID");
  if (signal.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  if (Platform.OS === "web") {
    const result = await fetch(`/api/admission?availability=${encodeURIComponent(storeId)}`, {
      method: "GET", signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      ...(actorId ? { headers: { "X-Merchant-Context": actorId } } : {}),
    });
    const body = await result.json();
    if (signal.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
    if (!result.ok) throw new DshPublicError(result.status, body.code);
    if (!body?.availability || body.availability.storeId !== storeId) {
      throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
    }
    return body.availability as StoreOperationalAvailability;
  }
  return withNativeMerchantSession(signal, (bearer, origin) =>
    getStoreOperationalAvailability(origin, storeId, bearer, signal), actorId);
}

export async function saveMerchantAvailability(
  storeId: string, actorId: string, change: StoreOperationalChange, signal: AbortSignal,
): Promise<void> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId) throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    await withNativeMerchantSession(signal, (bearer, origin) =>
      updateStoreOperationalAvailability(origin, storeId, bearer, change, signal), actorId, true);
    return;
  }
  let result: Response;
  try {
    result = await fetch(`/api/admission?availability=${encodeURIComponent(storeId)}`, {
      method: "PATCH", signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", "X-Merchant-Context": actorId },
      body: JSON.stringify(change),
    });
  } catch {
    // Dispatch may have committed before the connection failed.
    throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  }
  let body: unknown;
  try {
    body = await result.json();
  } catch {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  if (signal.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  if (!result.ok) {
    const code = body && typeof body === "object" && !Array.isArray(body) &&
      "code" in body && typeof body.code === "string" ? body.code : "OPERATION_RESULT_UNKNOWN";
    throw new DshPublicError(result.status, result.status >= 500 ? "OPERATION_RESULT_UNKNOWN" : code);
  }
  const availability = body && typeof body === "object" && !Array.isArray(body) &&
    "availability" in body && body.availability && typeof body.availability === "object" &&
    !Array.isArray(body.availability) ? body.availability as Record<string, unknown> : null;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    !("replay" in body) || typeof body.replay !== "boolean" ||
    availability?.storeId !== storeId || !Number.isSafeInteger(availability.version) ||
    availability.version !== change.expectedVersion + 1) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
}
