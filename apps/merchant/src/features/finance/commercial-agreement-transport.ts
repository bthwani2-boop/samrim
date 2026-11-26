import {
  isolatedNativeWltOrigin, parseCommercialAgreementReview, readOwnedMerchantCommercialAgreementReview, WltReadError,
} from "@bthwani/wlt";
import { isDevice } from "expo-device";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";

export async function readMerchantCommercialAgreement(actorId: string, storeId: string, signal: AbortSignal) {
  if (!actorId || !/^[a-z0-9-]{1,64}$/.test(storeId)) throw new WltReadError(400);
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    const origin = isolatedNativeWltOrigin(Platform.OS, isDevice,
      process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN,
      process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_WLT_ORIGIN);
    if (!origin) throw new WltReadError(503);
    return withNativeMerchantSession(signal, bearer =>
      readOwnedMerchantCommercialAgreementReview(origin, bearer, storeId, signal), actorId);
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
