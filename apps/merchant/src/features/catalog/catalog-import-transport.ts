import {
  type MerchantCatalogImportChange,
  type MerchantCatalogImportResult,
  merchantCatalogImport,
  prepareMerchantCatalogImport,
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
  const prepared = prepareMerchantCatalogImport(actorId, storeId, runId, method, change, offset);
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      merchantCatalogImport(origin, actorId, storeId, runId, bearer, method, signal, prepared.change, offset),
    actorId, method !== "GET");
  }
  const query = new URLSearchParams({ catalogImport: storeId, run: runId });
  if (method === "GET" && offset) query.set("offset", String(offset));
  const { document } = await requestMerchantOwnerDocument({ query, actorId, method, signal, change: prepared.change });
  return prepared.acceptResult(document.catalogImport);
}
