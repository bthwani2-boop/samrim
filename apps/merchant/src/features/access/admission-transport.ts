import {
  createMerchantCatalogDraft, DshPublicError, getStoreOperationalAvailability, listMerchantCatalog,
  type MerchantCatalogDraftChange, type MerchantCatalogDraftEditChange, type MerchantCatalogDraftEditResult, type MerchantCatalogDraftResult, type MerchantCatalogPage,
  type MerchantRegistrationOptions, type MerchantRegistrationResult,
  type MerchantStoreRegistration,parseMerchantCatalogDraftEditResult,
  parseMerchantCatalogDraftResult, parseMerchantCatalogPage,
  parseMerchantRegistrationOptions, parseMerchantRegistrationResult,
  readMerchantRegistrationOptions,
  registerMerchantStore, type StoreOperationalAvailability,
  type StoreOperationalChange,
  updateMerchantCatalogDraft,updateStoreOperationalAvailability,
  validMerchantStoreRegistration,
} from "@bthwani/dsh";
import {
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  readPersistentIdentityRole,
  revokePersistentIdentitySession,
  revokeVerifiedIdentitySession,
  type VerifiedIdentitySession,
} from "@bthwani/identity";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { revokeUndeliveredAdmissionSession, verifyMerchantAdmission } from "./admission";
import { MerchantStandingError, readMerchantDSHStanding, standingFrom } from "./dsh-standing";

const storageKey = process.env.EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW === "1"
  ? "bthwani.merchant.synthetic-admission.surface.v1" : "bthwani.merchant.synthetic-admission.v1";
// Persist before writing an issued bearer. An interrupted write must remain
// quarantined even after the JavaScript process loses its in-memory state.
const pendingStorageKey = `${storageKey}.pending.v1`;
const refreshStorageKey = `${storageKey}.refresh.v1`;
const nativeOrigin = process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
const nativeDSHOrigin = process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN;
const nativeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
type EntryState = { enabled: boolean; session: VerifiedIdentitySession | null };

// Serialize app-local SecureStore mutations so late owner responses cannot erase
// a newer sign-in written while the old request was in flight.
let nativeStorageMutation: Promise<void> = Promise.resolve();
let deniedNativeBearer: string | null = null;
let nativeAdmissionInFlight = false;
function mutateNativeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeStorageMutation.then(operation);
  nativeStorageMutation = result.then(() => undefined, () => undefined);
  return result;
}
async function clearPendingNativeAdmission(signal: AbortSignal): Promise<boolean> {
  return mutateNativeStorage(async () => {
    const pending = await SecureStore.getItemAsync(pendingStorageKey, nativeOptions);
    if (!pending) return false;
    if (signal.aborted) return true;
    {
      const refresh = await SecureStore.getItemAsync(refreshStorageKey, nativeOptions);
      if (refresh) {
        try { await revokePersistentIdentitySession(requireNativeOrigin(), refresh, signal); }
        catch (error) {
          if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
        }
      }
    }
    const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
    if (bearer) {
      deniedNativeBearer = bearer;
      try {
        await SecureStore.deleteItemAsync(storageKey, nativeOptions);
      } catch {
        // Never delete the durable quarantine if bearer deletion is uncertain.
        return true;
      }
    }
    await SecureStore.deleteItemAsync(refreshStorageKey, nativeOptions).catch(() => {});
    await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions).catch(() => {});
    return true;
  });
}

function clearNativeBearerIfCurrent(bearer: string, signal: AbortSignal): Promise<void> {
  return mutateNativeStorage(async () => {
    if (signal.aborted) return;
    if (await SecureStore.getItemAsync(storageKey, nativeOptions) !== bearer || signal.aborted) return;
    await SecureStore.deleteItemAsync(storageKey, nativeOptions);
    await SecureStore.deleteItemAsync(refreshStorageKey, nativeOptions).catch(() => {});
  });
}

let durableMerchantInFlight: Promise<Awaited<ReturnType<typeof readPersistentIdentityRole>>> | null = null;
async function readDurableMerchant(bearer: string, signal: AbortSignal) {
  if (durableMerchantInFlight) return durableMerchantInFlight;
  const pending = (async () => {
  const refresh = await SecureStore.getItemAsync(refreshStorageKey, nativeOptions);
  return readPersistentIdentityRole(requireNativeOrigin(), bearer, refresh, "merchant", signal,
    () => mutateNativeStorage(async () => {
      if (signal.aborted || await SecureStore.getItemAsync(pendingStorageKey, nativeOptions) ||
          await SecureStore.getItemAsync(storageKey, nativeOptions) !== bearer) {
        throw new IdentityClientError(0, "OWNER_RESPONSE_STALE");
      }
      await SecureStore.setItemAsync(pendingStorageKey, "refreshing", nativeOptions);
    }),
    (issued, before, rotated) => mutateNativeStorage(async () => {
      const pending = await SecureStore.getItemAsync(pendingStorageKey, nativeOptions);
      if (signal.aborted || await SecureStore.getItemAsync(storageKey, nativeOptions) !== before ||
          (pending && (!rotated || pending !== "refreshing"))) return false;
      await SecureStore.setItemAsync(refreshStorageKey, issued.refreshToken, nativeOptions);
      if (rotated) {
        await SecureStore.setItemAsync(storageKey, issued.accessToken, nativeOptions);
        await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions);
      }
      return true;
    }));
  })();
  durableMerchantInFlight = pending;
  try { return await pending; }
  finally { if (durableMerchantInFlight === pending) durableMerchantInFlight = null; }
}

async function webRequest<T>(method: string, signal: AbortSignal, data?: object, stores = false): Promise<T> {
  const result = await fetch(stores ? "/api/admission?stores=mine" : "/api/admission", {
    method,
    signal,
    credentials: "same-origin",
    cache: "no-store",
    ...(data === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  });
  if (result.status === 204) return undefined as T;
  const body = await result.json();
  if (!result.ok) throw new IdentityClientError(result.status, body.code);
  return body as T;
}

function requireNativeOrigin() {
  if (!nativeOrigin) throw new IdentityClientError(503, "OWNER_UNAVAILABLE");
  return nativeOrigin;
}

export async function readAdmission(signal: AbortSignal): Promise<EntryState> {
  if (Platform.OS === "web") return webRequest("GET", signal);
  if (!nativeOrigin) return { enabled: false, session: null };
  if (durableMerchantInFlight) await durableMerchantInFlight.catch(() => undefined);
  if (await clearPendingNativeAdmission(signal)) return { enabled: true, session: null };
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (bearer && bearer === deniedNativeBearer) {
    await clearNativeBearerIfCurrent(bearer, signal).catch(() => {});
    return { enabled: true, session: null };
  }
  if (bearer) {
    try {
      const current = await readDurableMerchant(bearer, signal);
      if (current.session.role === "merchant" &&
          await SecureStore.getItemAsync(storageKey, nativeOptions) === current.bearer &&
          !await SecureStore.getItemAsync(pendingStorageKey, nativeOptions)) {
        return { enabled: true, session: current.session };
      }
    } catch (error) {
      if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) throw error;
    }
    if (!signal.aborted) {
      // Identity denial (or a non-Merchant role) is authoritative even when
      // SecureStore is temporarily unable to delete the old credential.
      deniedNativeBearer = bearer;
      await clearNativeBearerIfCurrent(bearer, signal).catch(() => {});
    }
  }
  return { enabled: true, session: null };
}

/** DSH Store standing is requested separately from session issuance. It never
 * grants entry to an unverified Store or mutates the business owner. */
export async function readMerchantStanding(signal: AbortSignal) {
  if (Platform.OS === "web") {
    const result = await webRequest<{ standing: unknown }>("GET", signal, undefined, true);
    return standingFrom(result.standing);
  }
  // Preserve the standing API's unauthenticated result for a missing or
  // quarantined bearer; the shared session guard below additionally verifies
  // the active Identity role and rejects stale Store readback.
  if (durableMerchantInFlight) await durableMerchantInFlight.catch(() => undefined);
  if (await clearPendingNativeAdmission(signal)) {
    throw new MerchantStandingError(401, "UNAUTHENTICATED");
  }
  const initialBearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!initialBearer || initialBearer === deniedNativeBearer) {
    throw new MerchantStandingError(401, "UNAUTHENTICATED");
  }
  return withNativeMerchantSession(signal, async bearer => {
    try {
      return await readMerchantDSHStanding(nativeDSHOrigin ?? "", bearer, signal);
    } catch (error) {
      if (!signal.aborted && error instanceof MerchantStandingError &&
          (error.status === 401 || error.status === 403)) {
        // Deny only the bearer used by this request. A concurrent account
        // switch must never invalidate the replacement session.
        deniedNativeBearer = bearer;
        await clearNativeBearerIfCurrent(bearer, signal).catch(() => {});
      }
      throw error;
    }
  });
}

/** Registration choices come from the DSH policy owner, not app constants. */
export async function readMerchantStoreRegistrationOptions(
  actorId: string, signal: AbortSignal,
): Promise<MerchantRegistrationOptions> {
  if (Platform.OS !== "web") return withNativeMerchantSession(signal, bearer =>
    readMerchantRegistrationOptions(nativeDSHOrigin ?? "", bearer, signal), actorId);
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
  if (Platform.OS !== "web") return withNativeMerchantSession(signal, bearer =>
    registerMerchantStore(nativeDSHOrigin ?? "", bearer, input, signal), actorId, true);
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

/** The private catalog includes drafts; DSH verifies the current Store owner on every page. */
export async function readMerchantCatalogPage(
  storeId: string, actorId: string, signal: AbortSignal,
  options: { limit?: number; cursor?: string } = {},
): Promise<MerchantCatalogPage> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId || signal.aborted) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  if (Platform.OS !== "web") return withNativeMerchantSession(signal, bearer =>
    listMerchantCatalog(nativeDSHOrigin ?? "", storeId, actorId, bearer,
      { ...options, signal }), actorId);
  const query = new URLSearchParams({ catalog: storeId });
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  const reply = await fetch(`/api/admission?${query}`, {
    method: "GET", signal, credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "X-Merchant-Context": actorId },
  });
  if (signal.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  let payload: unknown;
  try { payload = await reply.json(); }
  catch { throw new DshPublicError(502, "OWNER_RESPONSE_INVALID"); }
  if (!reply.ok) {
    const v = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    throw new DshPublicError(reply.status, typeof v.code === "string" ? v.code : "OWNER_UNAVAILABLE");
  }
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  return parseMerchantCatalogPage(body.catalog, actorId, storeId);
}

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
  return withNativeMerchantSession(signal, bearer =>
    getStoreOperationalAvailability(nativeDSHOrigin ?? "", storeId, bearer, signal), actorId);
}

async function withNativeMerchantSession<T>(signal: AbortSignal, run: (bearer: string) => Promise<T>, actorId?: string,
  isWrite = false): Promise<T> {
  if (durableMerchantInFlight) await durableMerchantInFlight.catch(() => undefined);
  if (await clearPendingNativeAdmission(signal)) throw new IdentityClientError(401, "UNAUTHORIZED");
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!bearer || bearer === deniedNativeBearer) throw new IdentityClientError(401, "UNAUTHORIZED");
  let effectiveBearer = bearer;
  try {
    const current = await readDurableMerchant(bearer, signal);
    effectiveBearer = current.bearer;
    const session = current.session;
    if (session.role !== "merchant") throw new IdentityClientError(403, "FORBIDDEN");
    if (actorId !== undefined && session.actorId !== actorId) {
      throw new DshPublicError(403, "MERCHANT_CONTEXT_CHANGED");
    }
  } catch (error) {
    if (!signal.aborted && error instanceof IdentityClientError && (error.status === 401 || error.status === 403)) {
      deniedNativeBearer = bearer;
      await clearNativeBearerIfCurrent(bearer, signal).catch(() => {});
    }
    throw error;
  }
  const afterIdentity = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (signal.aborted || bearer === deniedNativeBearer || afterIdentity !== effectiveBearer) {
    throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  }
  // A scoped 403 does not invalidate the Merchant's unrelated Store grants.
  const result = await run(effectiveBearer);
  const afterOwner = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (signal.aborted || bearer === deniedNativeBearer || afterOwner !== effectiveBearer) {
    // A write may already have committed despite an account switch or abort.
    throw new DshPublicError(0, isWrite ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  }
  return result;
}


/** A lost acknowledgement is unknown: the caller retains and retries one stable operation ID. */
export async function submitMerchantCatalogDraft(
  storeId: string, actorId: string, change: MerchantCatalogDraftChange, signal: AbortSignal,
): Promise<MerchantCatalogDraftResult> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId || signal.aborted) {
    throw new DshPublicError(400, "INVALID_STORE_DRAFT");
  }
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, bearer =>
      createMerchantCatalogDraft(nativeDSHOrigin ?? "", storeId, bearer, change, signal), actorId, true);
  }
  let reply: Response;
  try {
    reply = await fetch(`/api/admission?catalog=${encodeURIComponent(storeId)}`, {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
      headers: { "Content-Type": "application/json", "X-Merchant-Context": actorId },
      body: JSON.stringify(change),
    });
  } catch { throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN"); }
  let json: unknown;
  try { json = await reply.json(); }
  catch { throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN"); }
  if (signal.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  if (!reply.ok) {
    const body = json && typeof json === "object" && !Array.isArray(json) ? json as Record<string, unknown> : {};
    throw new DshPublicError(reply.status, reply.status >= 500 ? "OPERATION_RESULT_UNKNOWN" :
      typeof body.code === "string" ? body.code : "INVALID_STORE_DRAFT");
  }
  const document = json && typeof json === "object" && !Array.isArray(json) ? json as Record<string, unknown> : {};
  if (![200, 201].includes(reply.status) ||
    reply.headers.get("Cache-Control")?.toLowerCase().split(",").map(part => part.trim()).includes("no-store") !== true) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  const draft = parseMerchantCatalogDraftResult(document.draft, storeId, change);
  if (draft.replay !== (reply.status === 200)) throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  return draft;
}

export async function saveMerchantAvailability(
  storeId: string, actorId: string, change: StoreOperationalChange, signal: AbortSignal,
): Promise<void> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId) throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    await withNativeMerchantSession(signal, bearer =>
      updateStoreOperationalAvailability(nativeDSHOrigin ?? "", storeId, bearer, change, signal), actorId, true);
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

export async function requestAdmissionCode(phone: string, signal: AbortSignal): Promise<string> {
  if (Platform.OS === "web") return (await webRequest<{ ticket: string }>("POST", signal, { phone })).ticket;
  return issueCustomerPhoneChallenge(requireNativeOrigin(), phone, signal);
}

export async function submitAdmissionCode(
  ticket: string, code: string, signal: AbortSignal,
): Promise<VerifiedIdentitySession> {
  if (Platform.OS === "web") {
    return (await webRequest<{ session: VerifiedIdentitySession }>("POST", signal, { ticket, code })).session;
  }
  if (nativeAdmissionInFlight) throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
  nativeAdmissionInFlight = true;
  try {
    const origin = requireNativeOrigin();
    if (durableMerchantInFlight) await durableMerchantInFlight.catch(() => undefined);
    if (await clearPendingNativeAdmission(signal) &&
        await SecureStore.getItemAsync(pendingStorageKey, nativeOptions)) {
      throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
    }
    const previousBearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
    if (previousBearer && previousBearer !== deniedNativeBearer) {
      try {
        const active = await readDurableMerchant(previousBearer, signal);
        if (active.session.role === "merchant") throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
      } catch (error) {
        if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) {
          throw error;
        }
      }
      if (!signal.aborted) {
        deniedNativeBearer = previousBearer;
        await clearNativeBearerIfCurrent(previousBearer, signal).catch(() => {});
      }
    }
    if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
    const { session, bearer } = await verifyMerchantAdmission(origin, ticket, code, signal);
    try {
      if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
      await mutateNativeStorage(async () => {
        if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
        // A concurrent sign-in may already have stored another verified actor.
        // Do not replace that credential with an earlier proof response.
        const currentBearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
        if (currentBearer && currentBearer !== previousBearer) {
          throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
        }
        await SecureStore.setItemAsync(pendingStorageKey, "in-flight", nativeOptions);
        await SecureStore.setItemAsync(storageKey, bearer, nativeOptions);
        if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
        // Removing this marker is the native-device commit point.
        // After an acknowledged bearer write, uncertain marker deletion cannot
        // turn a committed token into an undelivered error. If it remains, the
        // next cold-start read will still reject the bearer until cleanup.
        await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions).catch(() => {});
      });
      return session;
    } catch (error) {
      // SecureStore may write successfully and then report a device error.
      // Keep any undelivered bearer quarantined even if deletion itself fails.
      deniedNativeBearer = bearer;
      await mutateNativeStorage(async () => {
        if (await SecureStore.getItemAsync(storageKey, nativeOptions) === bearer) {
          await SecureStore.deleteItemAsync(storageKey, nativeOptions);
        }
      }).catch(() => {});
      await revokeUndeliveredAdmissionSession(origin, bearer);
      throw error;
    }
  } finally {
    nativeAdmissionInFlight = false;
  }
}

export async function signOutOfAdmission(signal: AbortSignal): Promise<void> {
  if (Platform.OS === "web") return webRequest("DELETE", signal);
  const bearer = await mutateNativeStorage(async () => {
    const stored = await SecureStore.getItemAsync(storageKey, nativeOptions);
    if (stored) await SecureStore.setItemAsync(pendingStorageKey, "sign-out", nativeOptions);
    return stored;
  });
  if (!bearer) return;
  const refresh = await SecureStore.getItemAsync(refreshStorageKey, nativeOptions);
  if (refresh) {
    try { await revokePersistentIdentitySession(requireNativeOrigin(), refresh, signal); }
    catch (error) {
      if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
    }
  }
  try {
    await revokeVerifiedIdentitySession(requireNativeOrigin(), bearer, signal);
  } catch (error) {
    if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) throw error;
  }
  await mutateNativeStorage(async () => {
    if (await SecureStore.getItemAsync(storageKey, nativeOptions) !== bearer) return;
    await SecureStore.deleteItemAsync(storageKey, nativeOptions);
    await SecureStore.deleteItemAsync(refreshStorageKey, nativeOptions);
    await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions);
  });
}

/** Versioned, idempotent edit of a DSH-owned inactive draft. No new operation key on retry. */
export async function submitMerchantCatalogDraftEdit(
  storeId: string, offerId: string, actorId: string,
  change: MerchantCatalogDraftEditChange, signal: AbortSignal,
): Promise<MerchantCatalogDraftEditResult> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !/^[a-z0-9-]{1,64}$/.test(offerId) ||
    !actorId || signal.aborted) throw new DshPublicError(400, "INVALID_STORE_DRAFT");
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, bearer =>
      updateMerchantCatalogDraft(nativeDSHOrigin ?? "", storeId, offerId, bearer, change, signal), actorId, true);
  }
  let reply: Response;
  try {
    reply = await fetch(`/api/admission?catalog=${encodeURIComponent(storeId)}&offer=${encodeURIComponent(offerId)}`, {
      method: "PATCH", credentials: "same-origin", cache: "no-store",
      redirect: "error", signal,
      headers: { "Content-Type": "application/json", "X-Merchant-Context": actorId },
      body: JSON.stringify(change),
    });
  } catch { throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN"); }
  let payload: unknown;
  try { payload = await reply.json(); }
  catch { throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN"); }
  if (signal.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  if (!reply.ok) {
    const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    throw new DshPublicError(reply.status, reply.status >= 500 ? "OPERATION_RESULT_UNKNOWN" :
      typeof body.code === "string" ? body.code : "INVALID_STORE_DRAFT");
  }
  const document = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (reply.status !== 200 ||
    reply.headers.get("Cache-Control")?.toLowerCase().split(",").map(part => part.trim()).includes("no-store") !== true) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return parseMerchantCatalogDraftEditResult(document.edit, storeId, offerId, change);
}
