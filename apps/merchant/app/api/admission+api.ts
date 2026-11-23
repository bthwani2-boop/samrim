import { createMerchantCatalogDraft, DshPublicError, getStoreOperationalAvailability, listMerchantCatalog, type MerchantCatalogDraftChange, type MerchantCatalogDraftEditChange, type MerchantStoreRegistration, readMerchantRegistrationOptions, registerMerchantStore, type StoreOperationalChange, updateMerchantCatalogDraft, updateStoreOperationalAvailability, validMerchantCatalogDraft, validMerchantCatalogDraftEdit } from "@bthwani/dsh";
import {
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  revokeVerifiedIdentitySession,
} from "@bthwani/identity";
import { verifyMerchantAdmission } from "../../src/features/access/admission.ts";
import { MerchantStandingError, readMerchantDSHStanding } from "../../src/features/access/dsh-standing.ts";

const cookieName = process.env.BTHWANI_SURFACE_PREVIEW === "1"
  ? "bthwani_surface_merchant_admission" : "bthwani_merchant_admission";
const localIdentity = "http://127.0.0.1:3201";
const localDSH = "http://127.0.0.1:3202";
const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

async function configuredOrigin(request: Request) {
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) return undefined;
  const configured = process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
  if (configured || process.env.NODE_ENV !== "development") return configured;
  try {
    // The isolated phone handler returns 405 for a GET only while enabled.
    // This is a read-only readiness check, independent of Metro startup.
    const readiness = await fetch(localIdentity + "/v1/customer-auth/phone-challenges", {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    await readiness.body?.cancel();
    if (readiness.status === 405 && readiness.headers.get("Allow") === "POST") return localIdentity;
  } catch {
    // Keep local admission unavailable until the owner responds.
  }
}

function standingOrigin(identity: string) {
  return process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN ??
    (process.env.NODE_ENV === "development" && identity === localIdentity ? localDSH : "");
}

function response(value: unknown, status = 200, cookie?: string) {
  const headers = new Headers(noStoreHeaders);
  if (cookie !== undefined) headers.set("Set-Cookie", cookie);
  return Response.json(value, { status, headers });
}

function sessionCookie(request: Request, bearer: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${bearer}; Path=/api/admission; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function bearerFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map(entry => entry.trim())
    .find(entry => entry.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
}

function isLocalMutation(request: Request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

function ownerError(error: unknown) {
  if (error instanceof DshPublicError && error.code === "OPERATION_RESULT_UNKNOWN") {
    return response({ code: error.code }, 503);
  }
  if ((error instanceof IdentityClientError || error instanceof MerchantStandingError || error instanceof DshPublicError) &&
      error.status >= 400 && error.status < 500) {
    return response({ code: error.code }, error.status);
  }
  return response({ code: "OWNER_UNAVAILABLE" }, 503);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const stores = query.size === 1 && query.get("stores") === "mine";
  const registration = query.size === 1 && query.get("registration") === "options";
  const storeId = query.size === 1 ? query.get("availability") : null;
  const availability = storeId !== null && /^[a-z0-9-]{1,64}$/.test(storeId);
  const catalogId = query.get("catalog");
  const validCatalogKeys = [...query.keys()].every(key =>
    ["catalog", "cursor", "limit"].includes(key) && query.getAll(key).length === 1);
  const limitValue = query.get("limit");
  const cursorValue = query.get("cursor");
  const catalog = catalogId !== null && /^[a-z0-9-]{1,64}$/.test(catalogId) &&
    validCatalogKeys && query.size <= 3 &&
    (limitValue === null || /^(?:[1-9]|[1-4][0-9]|50)$/.test(limitValue)) &&
    (cursorValue === null || /^[a-z0-9-]{1,64}$/.test(cursorValue));
  if (query.size > 0 && !stores && !availability && !registration && !catalog) {
    return response({ code: "INVALID_REQUEST" }, 400);
  }
  const origin = await configuredOrigin(request);
  if (!origin) return stores || availability || registration || catalog ? response({ code: "OWNER_UNAVAILABLE" }, 503) :
    response({ enabled: false, session: null });
  const bearer = bearerFrom(request);
  if (!bearer) return stores || availability || registration || catalog ? response({ code: "UNAUTHENTICATED" }, 401) :
    response({ enabled: true, session: null });
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const session = await readVerifiedIdentitySession(origin, bearer, signal);
    if (session.role === "merchant") {
      if (registration) {
        const actorId = request.headers.get("X-Merchant-Context");
        if (actorId !== null && actorId !== session.actorId) {
          return response({ code: "MERCHANT_CONTEXT_CHANGED" }, 403);
        }
        return response({ options: await readMerchantRegistrationOptions(
          standingOrigin(origin), bearer, signal) });
      }
      if (catalog) {
        const actorId = request.headers.get("X-Merchant-Context");
        if (actorId !== null && actorId !== session.actorId) {
          return response({ code: "MERCHANT_CONTEXT_CHANGED" }, 403);
        }
        return response({ catalog: await listMerchantCatalog(
          standingOrigin(origin), catalogId ?? "", session.actorId, bearer,
          { signal, ...(limitValue ? { limit: Number(limitValue) } : {}),
            ...(cursorValue ? { cursor: cursorValue } : {}) },
        ) });
      }
      if (availability) {
        const actorId = request.headers.get("X-Merchant-Context");
        if (actorId !== null && actorId !== session.actorId) {
          return response({ code: "MERCHANT_CONTEXT_CHANGED" }, 403);
        }
        return response({ availability: await getStoreOperationalAvailability(
          standingOrigin(origin), storeId, bearer, signal) });
      }
      if (!stores) return response({ enabled: true, session });
      const standing = await readMerchantDSHStanding(
        standingOrigin(origin), bearer, signal);
      if (standing.actorId !== session.actorId) {
        return response({ code: "OWNER_UNAVAILABLE" }, 503);
      }
      return response({ standing });
    }
  } catch (error) {
    // Owner-denied Merchant access expires its browser cookie. A transient
    // upstream outage must not discard an otherwise valid session.
    if (error instanceof DshPublicError) {
      // Store-scope denial must not sign the Merchant out of other valid Stores.
      return error.status === 401 ? response({ code: error.code }, 401, sessionCookie(request, "", 0)) : ownerError(error);
    }
    if ((error instanceof MerchantStandingError || error instanceof IdentityClientError) &&
      (error.status === 403 || (error instanceof MerchantStandingError && error.status === 401))) {
      return response({ code: error.code }, error.status, sessionCookie(request, "", 0));
    }
    if (!(error instanceof IdentityClientError && error.status === 401)) return ownerError(error);
  }
  return stores || availability || registration || catalog ? response({ code: "UNAUTHENTICATED" }, 401, sessionCookie(request, "", 0)) :
    response({ enabled: true, session: null }, 200, sessionCookie(request, "", 0));
}

async function readMutationBody(request: Request, limit: number): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) return null;
  const bytes = new Uint8Array(limit);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length + length > bytes.length) {
        await reader.cancel();
        return null;
      }
      bytes.set(value, length);
      length += value.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } catch {
    return null;
  }
}

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
  if (query.size > 0 && !registration && !catalogDraft) return response({ code: "INVALID_REQUEST" }, 400);
  const input = await readMutationBody(request, registration ? 4096 : catalogDraft ? 8192 : 512);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return response({ code: "INVALID_REQUEST" }, 400);
  }
  const data = input as Record<string, unknown>;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
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
      const remaining = Math.max(0, Math.floor((Date.parse(session.sessionExpiresAt) - Date.now()) / 1000));
      return response({ session }, 200, sessionCookie(request, bearer, remaining));
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
  if (bearer) {
    try {
      await revokeVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
    } catch (error) {
      if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) {
        return ownerError(error);
      }
    }
  }
  return new Response(null, {
    status: 204,
    headers: { ...noStoreHeaders, "Set-Cookie": sessionCookie(request, "", 0) },
  });
}
