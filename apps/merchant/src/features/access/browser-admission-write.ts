import { createMerchantCatalogDraft, DshPublicError, type MerchantCatalogDraftChange, type MerchantCatalogDraftEditChange, type MerchantStoreRegistration, registerMerchantEmployee, registerMerchantStore, type StoreOperationalChange, updateMerchantCatalogDraft, updateStoreOperationalAvailability, validEmployeeRegistration, validMerchantCatalogDraft, validMerchantCatalogDraftEdit } from "@bthwani/dsh";
import { establishPersistentIdentitySession, IdentityClientError, issueCustomerPhoneChallenge, readVerifiedIdentitySession, revokePersistentIdentitySession, revokeVerifiedIdentitySession } from "@bthwani/identity";
import { verifyMerchantAdmission } from "./admission.ts";
import {
  appendSessionCookies, bearerFrom, configuredOrigin, isLocalMutation, noStoreHeaders,
  ownerError, readMutationBody, refreshFrom, response, standingOrigin,
} from "./browser-admission-http.ts";

export async function PATCH(request: Request) {
  if (!isLocalMutation(request)) return response({ code: "FORBIDDEN" }, 403);
  const query = new URL(request.url).searchParams;
  const storeId = query.size === 1 ? query.get("availability") : null;
  const editStore = query.size === 2 ? query.get("catalog") : null;
  const editOffer = query.size === 2 ? query.get("offer") : null;
  const catalogEdit = editStore !== null && editOffer !== null &&
    /^[a-z0-9-]{1,64}$/.test(editStore) && /^[a-z0-9-]{1,64}$/.test(editOffer) &&
    [...query.keys()].every(key => (key === "catalog" || key === "offer") && query.getAll(key).length === 1);
  const actorId = request.headers.get("X-Merchant-Context");
  if ((!storeId || !/^[a-z0-9-]{1,64}$/.test(storeId)) && !catalogEdit || !actorId) {
    return response({ code: "INVALID_REQUEST" }, 400);
  }
  const bearer = bearerFrom(request);
  if (!bearer) return response({ code: "UNAUTHENTICATED" }, 401);
  const input = await readMutationBody(request, 16 * 1024);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return response({ code: "INVALID_REQUEST" }, 400);
  }
  const origin = await configuredOrigin(request);
  if (!origin) return response({ code: "OWNER_UNAVAILABLE" }, 503);
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const session = await readVerifiedIdentitySession(origin, bearer, signal);
    if (session.role !== "merchant" || session.actorId !== actorId) {
      return response({ code: "MERCHANT_CONTEXT_CHANGED" }, 403);
    }
    if (catalogEdit) {
      const data = input as Record<string, unknown>;
      if (Object.keys(data).length !== 5 ||
        !Object.keys(data).every(key => ["operationId", "expectedVersion", "name", "priceYer", "stockUnits"].includes(key)) ||
        !validMerchantCatalogDraftEdit(data as MerchantCatalogDraftEditChange)) {
        return response({ code: "INVALID_STORE_DRAFT" }, 400);
      }
      const edit = await updateMerchantCatalogDraft(
        standingOrigin(origin), editStore ?? "", editOffer ?? "", bearer,
        data as MerchantCatalogDraftEditChange, signal,
      );
      return response({ edit });
    }
    return response(await updateStoreOperationalAvailability(
      standingOrigin(origin), storeId ?? "", bearer, input as StoreOperationalChange, signal,
    ));
  } catch (error) {
    if (error instanceof DshPublicError && error.code === "OPERATION_RESULT_UNKNOWN") {
      return response({ code: error.code }, 503);
    }
    return ownerError(error);
  }
}

export async function POST(request: Request) {
  const origin = await configuredOrigin(request);
  if (!origin) return response({ code: "OWNER_UNAVAILABLE" }, 503);
  if (!isLocalMutation(request)) return response({ code: "FORBIDDEN" }, 403);
  const query = new URL(request.url).searchParams;
  const registration = query.size === 1 && query.get("registration") === "create";
  const catalogStore = query.size === 1 ? query.get("catalog") : null;
  const catalogDraft = catalogStore !== null && /^[a-z0-9-]{1,64}$/.test(catalogStore);
  const employeeStore = query.size===1 ? query.get("employees") : null;
  const employeeRegistration = employeeStore!==null && /^[a-z0-9-]{1,64}$/.test(employeeStore);
  if (query.size > 0 && !registration && !catalogDraft && !employeeRegistration) return response({ code: "INVALID_REQUEST" }, 400);
  const input = await readMutationBody(request, registration || employeeRegistration ? 4096 : catalogDraft ? 8192 : 512);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return response({ code: "INVALID_REQUEST" }, 400);
  }
  const data = input as Record<string, unknown>;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
    if (employeeRegistration) {
      if (!validEmployeeRegistration(data)) return response({code:"EMPLOYEE_REGISTRATION_INVALID"},400);
      const bearer=bearerFrom(request);
      if (!bearer) return response({code:"UNAUTHENTICATED"},401);
      const session=await readVerifiedIdentitySession(origin,bearer,signal);
      const actorId=request.headers.get("X-Merchant-Context");
      if (session.role!=="merchant" || !actorId || actorId!==session.actorId) return response({code:"MERCHANT_CONTEXT_CHANGED"},403);
      const id=await registerMerchantEmployee(standingOrigin(origin),bearer,employeeStore,data,signal);
      return response({employee:{actorId,storeId:employeeStore,id}});
    }
    if (catalogDraft) {
      if (!Object.keys(data).every(key => ["operationId", "name", "priceYer", "stockUnits"].includes(key)) ||
        Object.keys(data).length !== 4 || !validMerchantCatalogDraft(data as MerchantCatalogDraftChange)) {
        return response({ code: "INVALID_STORE_DRAFT" }, 400);
      }
      const bearer = bearerFrom(request);
      if (!bearer) return response({ code: "UNAUTHENTICATED" }, 401);
      const session = await readVerifiedIdentitySession(origin, bearer, signal);
      if (session.role !== "merchant") return response({ code: "STORE_OPERATION_FORBIDDEN" }, 403);
      const actor = request.headers.get("X-Merchant-Context");
      if (!actor || actor !== session.actorId) return response({ code: "MERCHANT_CONTEXT_CHANGED" }, 403);
      const draft = await createMerchantCatalogDraft(standingOrigin(origin), catalogStore ?? "", bearer,
        data as MerchantCatalogDraftChange, signal);
      return response({ draft }, draft.replay ? 200 : 201);
    }
    if (registration) {
      if (Object.keys(data).length !== 1 || !data.storeRegistration ||
        typeof data.storeRegistration !== "object" || Array.isArray(data.storeRegistration)) {
        return response({ code: "INVALID_STORE_REGISTRATION" }, 400);
      }
      const bearer = bearerFrom(request);
      if (!bearer) return response({ code: "UNAUTHENTICATED" }, 401);
      const session = await readVerifiedIdentitySession(origin, bearer, signal);
      if (session.role !== "merchant") return response({ code: "STORE_OPERATION_FORBIDDEN" }, 403);
      const actingActor = request.headers.get("X-Merchant-Context");
      if (actingActor !== null && actingActor !== session.actorId) {
        return response({ code: "MERCHANT_CONTEXT_CHANGED" }, 403);
      }
      const result = await registerMerchantStore(standingOrigin(origin), bearer,
        data.storeRegistration as MerchantStoreRegistration, signal);
      return response({ registration: result }, result.replay ? 200 : 201);
    }
    if (Object.keys(data).length === 1 && typeof data.phone === "string") {
      const ticket = await issueCustomerPhoneChallenge(origin, data.phone, signal);
      return response({ ticket }, 201);
    }
    if (Object.keys(data).length === 2 && typeof data.ticket === "string" && typeof data.code === "string") {
      // An expired access cookie does not end its persistent Identity family.
      if (refreshFrom(request)) return response({ code: "SIGN_OUT_REQUIRED" }, 409);
      const currentBearer = bearerFrom(request);
      if (currentBearer) {
        try {
          await readVerifiedIdentitySession(origin, currentBearer, signal);
          return response({ code: "SIGN_OUT_REQUIRED" }, 409);
        } catch (error) {
          if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
        }
      }
      const { bearer, session } = await verifyMerchantAdmission(origin, data.ticket, data.code, signal);
      const result = response({ session }, 200);
      const persistent = await establishPersistentIdentitySession(origin, bearer, signal).catch(() => null);
      return appendSessionCookies(result,request,bearer,session.sessionExpiresAt,persistent);
    }
    return response({ code: "INVALID_REQUEST" }, 400);
  } catch (error) {
    return ownerError(error);
  }
}

export async function DELETE(request: Request) {
  const origin = await configuredOrigin(request);
  if (!origin) return response({ code: "OWNER_UNAVAILABLE" }, 503);
  if (!isLocalMutation(request)) return response({ code: "FORBIDDEN" }, 403);
  const bearer = bearerFrom(request);
  const refresh = refreshFrom(request);
  if (refresh) {
    try { await revokePersistentIdentitySession(origin, refresh, AbortSignal.timeout(5000)); }
    catch (error) {
      if (!(error instanceof IdentityClientError && error.status === 401)) return ownerError(error);
    }
  }
  if (bearer) {
    try {
      await revokeVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
    } catch (error) {
      if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) {
        return ownerError(error);
      }
    }
  }
  return appendSessionCookies(new Response(null, { status: 204, headers: noStoreHeaders }),
    request,"",new Date(0).toISOString(),null);
}
