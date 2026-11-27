import { DshPublicError } from "@bthwani/dsh";
import {
  type CommercialAgreementReview, isolatedNativeWltOrigin, parseCommercialAgreementReview,
  readOwnedMerchantCommercialAgreementReview, WltReadError,
} from "@bthwani/wlt";
import { isDevice } from "expo-device";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";
import { requestMerchantOwnerDocument } from "../access/merchant-owner-web.ts";

const storeIdPattern = /^[a-z0-9-]{1,64}$/;
// WLT bounds its proposal to 4096 bytes; allow the Merchant actor envelope.
const agreementDocumentLimit = 8192;

function scopedReview(document: Record<string, unknown>, actorId: string, storeId: string): CommercialAgreementReview {
  const agreement = document.agreement;
  if (Object.keys(document).length !== 1 || !agreement ||
    typeof agreement !== "object" || Array.isArray(agreement) ||
    !("actorId" in agreement) || agreement.actorId !== actorId ||
    !("review" in agreement) || Object.keys(agreement).length !== 2) {
    throw new WltReadError(502);
  }
  return parseCommercialAgreementReview(agreement.review, storeId);
}

/** Read-only projection: the WLT SDK owns all commercial terms and Store validation. */
export async function readMerchantCommercialAgreement(
  actorId: string, storeId: string, signal: AbortSignal,
): Promise<CommercialAgreementReview> {
  if (typeof actorId !== "string" || !actorId ||
    typeof storeId !== "string" || !storeIdPattern.test(storeId)) {
    throw new WltReadError(400);
  }
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    const origin = isolatedNativeWltOrigin(Platform.OS, isDevice,
      process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN,
      process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_WLT_ORIGIN);
    if (!origin) throw new WltReadError(503);
    return withNativeMerchantSession(signal, bearer =>
      readOwnedMerchantCommercialAgreementReview(origin, bearer, storeId, signal), actorId);
  }

  let document: Record<string, unknown>;
  try {
    ({ document } = await requestMerchantOwnerDocument({
      query: new URLSearchParams({ agreement: storeId }), actorId, method: "GET", signal,
      byteLimit: agreementDocumentLimit,
    }));
  } catch (error) {
    signal.throwIfAborted();
    throw new WltReadError(error instanceof DshPublicError ? error.status || 503 : 503);
  }
  signal.throwIfAborted();
  return scopedReview(document, actorId, storeId);
}
