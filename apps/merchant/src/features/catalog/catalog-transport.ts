import {
  createMerchantCatalogDraft,
  DshPublicError,
  listMerchantCatalog,
  type MerchantCatalogDraftChange,
  type MerchantCatalogDraftEditChange,
  type MerchantCatalogDraftEditResult,
  type MerchantCatalogDraftHistoryPage,
  type MerchantCatalogDraftResult,
  type MerchantCatalogPage,
  type MerchantCatalogStatus,
  type MerchantInventorySummary,
  parseMerchantCatalogDraftEditResult,
  parseMerchantCatalogDraftHistory,
  parseMerchantCatalogDraftResult,
  parseMerchantCatalogPage,
  parseMerchantInventorySummary,
  readMerchantCatalogDraftHistory as readOwnerDraftHistory,
  readMerchantInventorySummary as readOwnerInventorySummary,
  updateMerchantCatalogDraft,
  validMerchantCatalogSearch,
  validMerchantCatalogStatus,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";
import { requestMerchantOwnerDocument } from "../access/merchant-owner-web.ts";

const storeKey = /^[a-z0-9-]{1,64}$/;
const catalogPageByteLimit = 256 * 1024;

/** The private catalog includes drafts; DSH verifies the current Store owner on every page. */
export async function readMerchantCatalogPage(
  storeId: string, actorId: string, signal: AbortSignal,
  options: { limit?: number; cursor?: string; query?: string; status?: MerchantCatalogStatus } = {},
): Promise<MerchantCatalogPage> {
  if (!storeKey.test(storeId) || !actorId || signal.aborted ||
    (options.query !== undefined && !validMerchantCatalogSearch(options.query)) ||
    (options.status !== undefined && !validMerchantCatalogStatus(options.status))) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      listMerchantCatalog(origin, storeId, actorId, bearer, { ...options, signal }), actorId);
  }
  const query = new URLSearchParams({ catalog: storeId });
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  if (options.query?.trim()) query.set("q", options.query);
  if (options.status !== undefined) query.set("status", options.status);
  const { document } = await requestMerchantOwnerDocument({
    query, actorId, method: "GET", signal, byteLimit: catalogPageByteLimit,
  });
  return parseMerchantCatalogPage(document.catalog, actorId, storeId, options.status);
}

/** A lost acknowledgement is unknown: the caller retains one stable operation ID. */
export async function submitMerchantCatalogDraft(
  storeId: string, actorId: string, change: MerchantCatalogDraftChange, signal: AbortSignal,
): Promise<MerchantCatalogDraftResult> {
  if (!storeKey.test(storeId) || !actorId || signal.aborted) {
    throw new DshPublicError(400, "INVALID_STORE_DRAFT");
  }
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      createMerchantCatalogDraft(origin, storeId, bearer, change, signal), actorId, true);
  }
  const { status, document } = await requestMerchantOwnerDocument({
    query: new URLSearchParams({ catalog: storeId }), actorId, method: "POST", signal,
    change, acceptedStatuses: [200, 201],
  });
  const draft = parseMerchantCatalogDraftResult(document.draft, storeId, change);
  if (draft.replay !== (status === 200)) throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  return draft;
}

/** Versioned, idempotent edit of a DSH-owned inactive draft. No new operation key on retry. */
export async function submitMerchantCatalogDraftEdit(
  storeId: string, offerId: string, actorId: string,
  change: MerchantCatalogDraftEditChange, signal: AbortSignal,
): Promise<MerchantCatalogDraftEditResult> {
  if (!storeKey.test(storeId) || !storeKey.test(offerId) || !actorId || signal.aborted) {
    throw new DshPublicError(400, "INVALID_STORE_DRAFT");
  }
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      updateMerchantCatalogDraft(origin, storeId, offerId, bearer, change, signal), actorId, true);
  }
  const { document } = await requestMerchantOwnerDocument({
    query: new URLSearchParams({ catalog: storeId, offer: offerId }), actorId, method: "PATCH", signal, change,
  });
  return parseMerchantCatalogDraftEditResult(document.edit, storeId, offerId, change);
}

/** Complete Store inventory counts, independent of catalog search and pagination. */
export async function readMerchantInventorySummary(
  storeId: string, actorId: string, signal: AbortSignal,
): Promise<MerchantInventorySummary> {
  if (!storeKey.test(storeId) || !actorId || signal.aborted) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      readOwnerInventorySummary(origin, storeId, actorId, bearer, signal), actorId);
  }
  const { document } = await requestMerchantOwnerDocument({
    query: new URLSearchParams({ inventory: storeId }), actorId, method: "GET", signal,
  });
  return parseMerchantInventorySummary(document.inventory, actorId, storeId);
}

export async function readMerchantCatalogDraftHistory(
  storeId: string, offerId: string, actorId: string, signal: AbortSignal, beforeVersion?: string,
): Promise<MerchantCatalogDraftHistoryPage> {
  if (!storeKey.test(storeId) || !storeKey.test(offerId) || !actorId || signal.aborted) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  const limit = 20;
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      readOwnerDraftHistory(origin, storeId, offerId, actorId, bearer, {
        limit, ...(beforeVersion !== undefined ? { beforeVersion } : {}), signal,
      }), actorId);
  }
  const query = new URLSearchParams({ draftHistory: storeId, offer: offerId, limit: String(limit) });
  if (beforeVersion !== undefined) query.set("beforeVersion", beforeVersion);
  const { document } = await requestMerchantOwnerDocument({ query, actorId, method: "GET", signal });
  return parseMerchantCatalogDraftHistory(document.draftHistory, actorId, storeId, offerId, limit, beforeVersion);
}
