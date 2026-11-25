import { type CustomerCheckoutReview, type CustomerCheckoutReviewInput, DshPublicError, parseCustomerCheckoutReview, reviewCurrentCustomerCheckout } from "@bthwani/dsh";
import { Platform } from "react-native";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json";
import { withVerifiedNativeCustomerRead } from "../access/customer-session-transport";
import { verifyAddressSession } from "../addresses/address-transport";

export async function readCheckoutReview(actor: string, store: string, input: CustomerCheckoutReviewInput, signal: AbortSignal):
Promise<{ kind: "ready"; review: CustomerCheckoutReview } | { kind: "signed-out" | "unavailable" }> {
  try {
    await verifyAddressSession(signal, actor);
    if (Platform.OS === "web") {
      const response = await fetch(`/api/customer-auth/checkout-review?storeId=${encodeURIComponent(store)}`, {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
        headers: { "Content-Type": "application/json", "X-Customer-Context": actor },
        body: JSON.stringify(input),
      });
      if (signal.aborted || response.status !== 200 || response.headers.get("Cache-Control") !== "no-store") {
        void response.body?.cancel().catch(() => {});
        signal.throwIfAborted();
        return { kind: response.status === 401 || response.status === 403 ? "signed-out" : "unavailable" };
      }
      const body = await readBoundedCustomerJSON({ headers: response.headers, body: response.body, signal }, 32 * 1024);
      if (body === null) {
        void response.body?.cancel().catch(() => {});
        return { kind: "unavailable" };
      }
      signal.throwIfAborted();
      const review = parseCustomerCheckoutReview(body, store, actor, input);
      await verifyAddressSession(signal, actor);
      signal.throwIfAborted();
      return { kind: "ready", review };
    }
    const owner = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
    if (!owner) return { kind: "unavailable" };
    const result = await withVerifiedNativeCustomerRead(signal,
      bearer => reviewCurrentCustomerCheckout(owner, bearer, actor, store, input, signal), actor);
    return result.kind === "ready" ? { kind: "ready", review: result.value } : result;
  } catch (error) {
    return { kind: error instanceof DshPublicError && (error.status === 401 || error.status === 403) ? "signed-out" : "unavailable" };
  }
}
