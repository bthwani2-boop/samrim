import { createMerchantCatalogDraft, DshPublicError, listMerchantCatalog, type MerchantCatalogDraftChange, type MerchantCatalogDraftEditChange, type MerchantCatalogDraftEditResult, type MerchantCatalogDraftResult, type MerchantCatalogPage, parseMerchantCatalogDraftEditResult, parseMerchantCatalogDraftResult, parseMerchantCatalogPage, type MerchantInventorySummary, parseMerchantInventorySummary, readMerchantInventorySummary as readOwnerInventorySummary, updateMerchantCatalogDraft, validMerchantCatalogSearch } from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";

/** The private catalog includes drafts; DSH verifies the current Store owner on every page. */
export async function readMerchantCatalogPage(
  storeId: string, actorId: string, signal: AbortSignal,
  options: { limit?: number; cursor?: string; query?: string } = {},
): Promise<MerchantCatalogPage> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId || signal.aborted ||
    (options.query !== undefined && !validMerchantCatalogSearch(options.query))) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  if (Platform.OS !== "web") return withNativeMerchantSession(signal, (bearer, origin) =>
    listMerchantCatalog(origin, storeId, actorId, bearer,
      { ...options, signal }), actorId);
  const query = new URLSearchParams({ catalog: storeId });
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  if (options.query?.trim()) query.set("q", options.query);
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

/** A lost acknowledgement is unknown: the caller retains and retries one stable operation ID. */
export async function submitMerchantCatalogDraft(
  storeId: string, actorId: string, change: MerchantCatalogDraftChange, signal: AbortSignal,
): Promise<MerchantCatalogDraftResult> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId || signal.aborted) {
    throw new DshPublicError(400, "INVALID_STORE_DRAFT");
  }
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      createMerchantCatalogDraft(origin, storeId, bearer, change, signal), actorId, true);
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

/** Versioned, idempotent edit of a DSH-owned inactive draft. No new operation key on retry. */
export async function submitMerchantCatalogDraftEdit(
  storeId: string, offerId: string, actorId: string,
  change: MerchantCatalogDraftEditChange, signal: AbortSignal,
): Promise<MerchantCatalogDraftEditResult> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !/^[a-z0-9-]{1,64}$/.test(offerId) ||
    !actorId || signal.aborted) throw new DshPublicError(400, "INVALID_STORE_DRAFT");
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      updateMerchantCatalogDraft(origin, storeId, offerId, bearer, change, signal), actorId, true);
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

/** Complete Store inventory counts, independent of catalog search and pagination. */
export async function readMerchantInventorySummary(
  storeId: string, actorId: string, signal: AbortSignal,
): Promise<MerchantInventorySummary> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId || signal.aborted) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  if (Platform.OS !== "web") return withNativeMerchantSession(signal, (bearer, origin) =>
    readOwnerInventorySummary(origin, storeId, actorId, bearer, signal), actorId);
  const reply = await fetch(`/api/admission?inventory=${encodeURIComponent(storeId)}`, {
    method: "GET", signal, credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "X-Merchant-Context": actorId },
  });
  let payload: unknown;
  try { payload = await reply.json(); }
  catch { throw new DshPublicError(502, "OWNER_RESPONSE_INVALID"); }
  if (signal.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (!reply.ok) throw new DshPublicError(reply.status, typeof body.code === "string" ? body.code : "OWNER_UNAVAILABLE");
  if (reply.status !== 200 ||
    reply.headers.get("Cache-Control")?.toLowerCase().split(",").map(part => part.trim()).includes("no-store") !== true) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return parseMerchantInventorySummary(body.inventory, actorId, storeId);
}
