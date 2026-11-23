import { DshPublicError, type MerchantRegistrationOptions, type MerchantRegistrationResult, type MerchantStoreRegistration, parseMerchantRegistrationOptions, parseMerchantRegistrationResult, readMerchantRegistrationOptions, registerMerchantStore, validMerchantStoreRegistration } from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";

/** Registration choices come from the DSH policy owner, not app constants. */
export async function readMerchantStoreRegistrationOptions(
  actorId: string, signal: AbortSignal,
): Promise<MerchantRegistrationOptions> {
  if (Platform.OS !== "web") return withNativeMerchantSession(signal, (bearer, origin) =>
    readMerchantRegistrationOptions(origin, bearer, signal), actorId);
  const reply = await fetch("/api/admission?registration=options", {
    method: "GET", signal, credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "X-Merchant-Context": actorId },
  });
  const body = await reply.json();
  if (signal.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  if (!reply.ok) throw new DshPublicError(reply.status, body?.code ?? "OWNER_UNAVAILABLE");
  return parseMerchantRegistrationOptions(body?.options);
}

/** Register a DSH Store under the live Merchant actor, never the caller's claimed actor ID. */
export async function createMerchantStore(
  actorId: string, input: MerchantStoreRegistration, signal: AbortSignal,
): Promise<MerchantRegistrationResult> {
  if (!actorId || !validMerchantStoreRegistration(input)) {
    throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  }
  signal.throwIfAborted();
  if (Platform.OS !== "web") return withNativeMerchantSession(signal, (bearer, origin) =>
    registerMerchantStore(origin, bearer, input, signal), actorId, true);
  let reply: Response;
  try {
    reply = await fetch("/api/admission?registration=create", {
      method: "POST", signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", "X-Merchant-Context": actorId },
      body: JSON.stringify({ storeRegistration: input }),
    });
  } catch {
    // The DSH transaction may have committed before the network failed.
    throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  }
  let body: unknown;
  try {
    body = await reply.json();
  } catch {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  if (signal.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  if (!reply.ok) {
    const code = body && typeof body === "object" && !Array.isArray(body) &&
      "code" in body && typeof body.code === "string" ? body.code : "OWNER_UNAVAILABLE";
    throw new DshPublicError(reply.status, reply.status >= 500 ? "OPERATION_RESULT_UNKNOWN" : code);
  }
  const result = body && typeof body === "object" && !Array.isArray(body) &&
    "registration" in body ? parseMerchantRegistrationResult(body.registration) :
    (() => { throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN"); })();
  if (![200, 201].includes(reply.status) || (reply.status === 201) === result.replay ||
      result.store.relation !== input.relation) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return result;
}
