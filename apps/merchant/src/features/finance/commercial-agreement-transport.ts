import { parseCommercialAgreementReview, readOwnedMerchantCommercialAgreementReview, WltReadError } from "@bthwani/wlt";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";

export async function readMerchantCommercialAgreement(actorId: string, storeId: string, signal: AbortSignal) {
  if (!actorId || !/^[a-z0-9-]{1,64}$/.test(storeId)) throw new WltReadError(400);
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, bearer => readOwnedMerchantCommercialAgreementReview(
      process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_WLT_ORIGIN ?? "", bearer, storeId, signal), actorId);
  }
  const reply = await fetch("/api/admission?agreement=" + encodeURIComponent(storeId), {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { "X-Merchant-Context": actorId },
  });
  if (!reply.ok) throw new WltReadError(reply.status);
  if (reply.headers.get("Cache-Control") !== "no-store") throw new WltReadError(502);
  const body = await reply.json();
  signal.throwIfAborted();
  if (body?.agreement?.actorId !== actorId) throw new WltReadError(502);
  return parseCommercialAgreementReview(body.agreement.review, storeId);
}
