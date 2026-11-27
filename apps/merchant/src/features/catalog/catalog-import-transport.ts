import {
  DshPublicError,
  type MerchantCatalogImportChange,
  type MerchantCatalogImportResult,
  merchantCatalogImport,
  parseMerchantCatalogImportResult,
  validMerchantCatalogImportChange,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";
import { requestMerchantOwnerDocument } from "../access/merchant-owner-web.ts";

type ImportMethod = "GET" | "PUT" | "PATCH";

export async function requestCatalogImport(
  actorId: string,
  storeId: string,
  runId: string,
  method: ImportMethod,
  signal: AbortSignal,
  change?: MerchantCatalogImportChange,
  offset = 0,
): Promise<MerchantCatalogImportResult> {
  const writing = method !== "GET";
  if (!actorId || !/^[a-z0-9-]{1,64}$/.test(storeId) ||
    !/^[A-Za-z0-9._-]{8,128}$/.test(runId) ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 5000 ||
    (writing && offset !== 0) ||
    (method === "PUT" ? !validMerchantCatalogImportChange(change) : change !== undefined)) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      merchantCatalogImport(origin, actorId, storeId, runId, bearer, method, signal, change, offset),
    actorId, writing);
  }
  const query = new URLSearchParams({ catalogImport: storeId, run: runId });
  if (method === "GET" && offset) query.set("offset", String(offset));
  const { document } = await requestMerchantOwnerDocument({ query, actorId, method, signal, change });
  const invalid = () => new DshPublicError(502,
    writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  try {
    const result = parseMerchantCatalogImportResult(document.catalogImport, actorId, storeId, runId);
    if ((change && (result.sourceSha256 !== change.sourceSha256 || result.total !== change.rows.length)) ||
      (method === "GET" && result.offset !== Math.min(offset, result.processed))) throw invalid();
    return result;
  } catch {
    throw invalid();
  }
}
