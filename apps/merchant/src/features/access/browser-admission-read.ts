import { DshPublicError, getMerchantEmployee, getMerchantEmployeeRegistrationAudit, getStoreOperationalAvailability, isCompanyEmployeeId, listMerchantCatalog, listMerchantEmployees, readMerchantInventorySummary, readMerchantRegistrationOptions, validEmployeeEndState, validMerchantCatalogSearch, validMerchantCatalogStatus } from "@bthwani/dsh";
import { IdentityClientError, readVerifiedIdentitySession, rotatePersistentIdentitySession } from "@bthwani/identity";
import { readOwnedMerchantCommercialAgreementReview, WltReadError } from "@bthwani/wlt";
import {
  appendSessionCookies, bearerFrom, configuredOrigin, cookieName, ownerError,
  refreshCookieName, refreshFrom, response, sessionCookie, standingOrigin,
} from "./browser-admission-http.ts";
import { MerchantStandingError, readMerchantDSHStanding } from "./dsh-standing.ts";

async function resumeMerchantBrowser(
  request: Request, origin: string, protectedRead: boolean,
): Promise<Response> {
  const refresh = refreshFrom(request);
  if (!refresh) return protectedRead ? response({ code: "UNAUTHENTICATED" }, 401)
    : response({ enabled: true, session: null });
  try {
    const rotated = await rotatePersistentIdentitySession(origin, refresh, AbortSignal.timeout(5000));
    const verified = await readVerifiedIdentitySession(origin, rotated.accessToken, AbortSignal.timeout(5000));
    if (verified.role !== "merchant") throw new IdentityClientError(403,"FORBIDDEN");
    const headers = new Headers(request.headers);
    const old = request.headers.get("cookie")?.split(";").map(value => value.trim()).filter(value =>
      !value.startsWith(cookieName+"=") && !value.startsWith(refreshCookieName+"=")) ?? [];
    headers.set("cookie", [...old, cookieName+"="+rotated.accessToken,
      refreshCookieName+"="+rotated.refreshToken].join("; "));
    const forwarded = new Request(request,{headers});
    const result = await merchantGet(forwarded,true);
    return appendSessionCookies(result,request,rotated.accessToken,verified.sessionExpiresAt,rotated);
  } catch (error) {
    if (!(error instanceof IdentityClientError && [401,403].includes(error.status))) return ownerError(error);
    const result = protectedRead ? response({ code: "UNAUTHENTICATED" }, 401)
      : response({ enabled: true, session: null });
    return appendSessionCookies(result,request,"",new Date(0).toISOString(),null);
  }
}

export async function GET(request: Request) { return merchantGet(request, false); }
async function merchantGet(request: Request, alreadyRotated: boolean): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const stores = query.size === 1 && query.get("stores") === "mine";
  const registration = query.size === 1 && query.get("registration") === "options";
  const storeId = query.size === 1 ? query.get("availability") : null;
  const availability = storeId !== null && /^[a-z0-9-]{1,64}$/.test(storeId);
  const catalogId = query.get("catalog");
  const validCatalogKeys = [...query.keys()].every(key =>
    ["catalog", "cursor", "limit", "q", "status"].includes(key) && query.getAll(key).length === 1);
  const limitValue = query.get("limit");
  const cursorValue = query.get("cursor");
  const searchValue = query.get("q");
  const statusValue = query.get("status");
  if (catalogId !== null && searchValue !== null) {
    // URLSearchParams replaces malformed UTF-8. Reject it before forwarding to DSH.
    try { decodeURIComponent(new URL(request.url).search); }
    catch { return response({ code: "INVALID_REQUEST" }, 400); }
  }
  const catalog = catalogId !== null && /^[a-z0-9-]{1,64}$/.test(catalogId) &&
    validCatalogKeys && query.size <= 5 &&
    (statusValue === null || validMerchantCatalogStatus(statusValue)) &&
    (searchValue === null || validMerchantCatalogSearch(searchValue)) &&
    (limitValue === null || /^(?:[1-9]|[1-4][0-9]|50)$/.test(limitValue)) &&
    (cursorValue === null || /^[a-z0-9-]{1,64}$/.test(cursorValue));
  const inventoryId = query.size === 1 ? query.get("inventory") : null;
  const inventory = inventoryId !== null && /^[a-z0-9-]{1,64}$/.test(inventoryId);
  const employeeStore = query.get("employees");
  const employeeCursor = query.get("cursor");
  const employeeId = query.get("employeeId");
  const employeeEndState = query.get("endState");
  const employees = employeeStore !== null && /^[a-z0-9-]{1,64}$/.test(employeeStore) &&
    [...query.keys()].every(key => ["employees","cursor","employeeId","endState"].includes(key) && query.getAll(key).length===1) &&
    (employeeCursor===null || isCompanyEmployeeId(employeeCursor)) &&
    (employeeEndState===null || validEmployeeEndState(employeeEndState)) &&
    (employeeId===null || (employeeCursor===null && employeeEndState===null && isCompanyEmployeeId(employeeId)));
  const agreementId = query.size === 1 ? query.get("agreement") : null;
  const agreement = agreementId !== null && /^[a-z0-9-]{1,64}$/.test(agreementId);
  const protectedRead = stores || availability || registration || catalog || inventory || employees || agreement;
  if (query.size > 0 && !protectedRead) {
    return response({ code: "INVALID_REQUEST" }, 400);
  }
  const origin = await configuredOrigin(request);
  if (!origin) return protectedRead ? response({ code: "OWNER_UNAVAILABLE" }, 503) :
    response({ enabled: false, session: null });
  const bearer = bearerFrom(request);
  if (!bearer) {
    if (!alreadyRotated && refreshFrom(request)) return resumeMerchantBrowser(request, origin, protectedRead);
    return protectedRead ? response({ code: "UNAUTHENTICATED" }, 401) :
      response({ enabled: true, session: null });
  }
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const session = await readVerifiedIdentitySession(origin, bearer, signal);
    if (session.role === "merchant") {
      if (agreement) {
        const actorId = request.headers.get("X-Merchant-Context");
        if (!actorId || actorId !== session.actorId) return response({ code: "MERCHANT_CONTEXT_CHANGED" }, 403);
        const wltOrigin = process.env.MERCHANT_SYNTHETIC_WLT_ORIGIN ??
          (process.env.NODE_ENV === "development" && origin === "http://127.0.0.1:3201" ? "http://127.0.0.1:3203" : "");
        if (!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(wltOrigin)) return response({ code: "OWNER_UNAVAILABLE" }, 503);
        try {
          const review = await readOwnedMerchantCommercialAgreementReview(wltOrigin, bearer, agreementId, signal);
          signal.throwIfAborted();
          return response({ agreement: { actorId: session.actorId, review } });
        } catch (error) {
          if (error instanceof WltReadError && [401, 403].includes(error.status)) {
            return response({ code: "STORE_ACCESS_DENIED" }, error.status);
          }
          return response({ code: "OWNER_UNAVAILABLE" }, 503);
        }
      }
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
            ...(cursorValue ? { cursor: cursorValue } : {}),
            ...(searchValue !== null ? { query: searchValue } : {}),
            ...(validMerchantCatalogStatus(statusValue) ? { status: statusValue } : {}) },
        ) });
      }
      if (employees) {
        const actorId=request.headers.get("X-Merchant-Context");
        if (!actorId || actorId!==session.actorId) return response({code:"MERCHANT_CONTEXT_CHANGED"},403);
        if (employeeId!==null) {
          const owner=standingOrigin(origin);
          const employee=await getMerchantEmployee(owner,bearer,employeeStore,employeeId,signal);
          const audit=await getMerchantEmployeeRegistrationAudit(owner,bearer,employeeStore,employeeId,signal);
          return response({employees:{actorId,storeId:employeeStore,detail:{employee,audit}}});
        }
        const page=await listMerchantEmployees(standingOrigin(origin),bearer,employeeStore,employeeCursor??undefined,signal,validEmployeeEndState(employeeEndState)?employeeEndState:undefined);
        return response({employees:{actorId,storeId:employeeStore,page}});
      }
      if (inventory) {
        const actorId = request.headers.get("X-Merchant-Context");
        if (actorId !== null && actorId !== session.actorId) {
          return response({ code: "MERCHANT_CONTEXT_CHANGED" }, 403);
        }
        return response({ inventory: await readMerchantInventorySummary(
          standingOrigin(origin), inventoryId, session.actorId, bearer, signal) });
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
    // DSH owns Store access, not Identity session validity. Its refusals never
    // clear the browser credential or grant access to protected Store data.
    if (error instanceof DshPublicError || error instanceof MerchantStandingError) return ownerError(error);
    if (error instanceof IdentityClientError && error.status === 403) {
      return response({ code: error.code }, error.status, sessionCookie(request, "", 0));
    }
    if (!(error instanceof IdentityClientError && error.status === 401)) return ownerError(error);
    if (!alreadyRotated && refreshFrom(request)) return resumeMerchantBrowser(request, origin, protectedRead);
  }
  return protectedRead ? response({ code: "UNAUTHENTICATED" }, 401, sessionCookie(request, "", 0)) :
    response({ enabled: true, session: null }, 200, sessionCookie(request, "", 0));
}
