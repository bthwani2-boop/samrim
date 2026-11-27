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
import { readMerchantJSON } from "../access/merchant-json.ts";

type ImportMethod = "GET" | "PUT" | "PATCH";

// The DSH receipt has at most 25 outcomes. Bound the enclosing BFF document,
// never the 8 MiB manifest, and preserve the same run identity on uncertainty.
const receiptLimit = 64 * 1024;
const receiptDeadline = 5000;

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

  const invalid = () => new DshPublicError(502,
    writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  const checkCurrent = () => {
    if (writing && signal.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
    signal.throwIfAborted();
  };
  const query = new URLSearchParams({ catalogImport: storeId, run: runId });
  if (method === "GET" && offset) query.set("offset", String(offset));
  let reply: Response;
  try {
    reply = await fetch("/api/admission?" + query, {
      method, signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "X-Merchant-Context": actorId, ...(change ? { "Content-Type": "application/json" } : {}) },
      ...(change ? { body: JSON.stringify(change) } : {}),
    });
  } catch {
    checkCurrent();
    throw new DshPublicError(0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_NETWORK_UNAVAILABLE");
  }

  const noStore = reply.headers.get("Cache-Control")?.toLowerCase().split(",")
    .some(value => value.trim() === "no-store");
  if (reply.ok && (reply.status !== 200 || !noStore)) {
    if (reply.body && !reply.body.locked) void reply.body.cancel().catch(() => {});
    checkCurrent();
    throw invalid();
  }

  const payload = await readMerchantJSON(reply, signal, receiptLimit, receiptDeadline);
  checkCurrent();
  const data = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : null;
  if (!reply.ok) {
    if (writing && (reply.status >= 500 || !data || typeof data.code !== "string")) {
      throw new DshPublicError(reply.status, "OPERATION_RESULT_UNKNOWN");
    }
    throw new DshPublicError(reply.status,
      typeof data?.code === "string" ? data.code : "OWNER_UNAVAILABLE");
  }
  try {
    const result = parseMerchantCatalogImportResult(data?.catalogImport, actorId, storeId, runId);
    if ((change && (result.sourceSha256 !== change.sourceSha256 || result.total !== change.rows.length)) ||
      (method === "GET" && result.offset !== Math.min(offset, result.processed))) throw invalid();
    return result;
  } catch {
    throw invalid();
  }
}
