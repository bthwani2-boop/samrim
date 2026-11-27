import {
  confirmMerchantRegistrationResult,
  DshPublicError,
  isMerchantRegistrationRejection,
  type MerchantRegistrationOptions,
  type MerchantRegistrationResult,
  type MerchantStoreRegistration,
  merchantRegistrationOptionsByteLimit,
  parseMerchantRegistrationOptions,
  readMerchantRegistrationOptions,
  registerMerchantStore,
  validMerchantStoreRegistration,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";
import { requestMerchantOwnerDocument } from "../access/merchant-owner-web.ts";

/** Registration choices come from the DSH policy owner, not app constants. */
export async function readMerchantStoreRegistrationOptions(
  actorId: string, signal: AbortSignal,
): Promise<MerchantRegistrationOptions> {
  if (!actorId) throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  if (signal.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  if (Platform.OS !== "web") return withNativeMerchantSession(signal, (bearer, origin) =>
    readMerchantRegistrationOptions(origin, bearer, signal), actorId);
  const { document } = await requestMerchantOwnerDocument({
    query: new URLSearchParams({ registration: "options" }),
    actorId, method: "GET", signal, byteLimit: merchantRegistrationOptionsByteLimit,
  });
  if (Object.keys(document).length !== 1 || !Object.hasOwn(document, "options")) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return parseMerchantRegistrationOptions(document.options);
}

/** Register a DSH Store under the live Merchant actor, never the caller's claimed actor ID. */
export async function createMerchantStore(
  actorId: string, input: MerchantStoreRegistration, signal: AbortSignal,
): Promise<MerchantRegistrationResult> {
  if (!actorId || !validMerchantStoreRegistration(input)) {
    throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  }
  if (signal.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  if (Platform.OS !== "web") return withNativeMerchantSession(signal, (bearer, origin) =>
    registerMerchantStore(origin, bearer, input, signal), actorId, true);
  try {
    const { status, document } = await requestMerchantOwnerDocument({
      query: new URLSearchParams({ registration: "create" }),
      actorId, method: "POST", signal,
      change: { storeRegistration: input }, acceptedStatuses: [200, 201],
    });
    if (Object.keys(document).length !== 1 || !Object.hasOwn(document, "registration")) {
      throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
    }
    return confirmMerchantRegistrationResult(document.registration, status, input);
  } catch (error) {
    // Never clear a durable attempt for an unrecognized or inconsistent
    // browser/BFF error. Only an exact owner rejection is definitive.
    if (error instanceof DshPublicError && isMerchantRegistrationRejection(error.status, error.code)) {
      throw error;
    }
    throw new DshPublicError(error instanceof DshPublicError ? error.status : 0, "OPERATION_RESULT_UNKNOWN");
  }
}
