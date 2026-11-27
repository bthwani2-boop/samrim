import {
  type CustomerCheckoutReview,
  type CustomerCheckoutReviewInput,
  DshPublicError,
  parseCustomerCheckoutReview,
  reviewCurrentCustomerCheckout,
  validCustomerCheckoutReviewInput,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import { discardCustomerResponse, readBoundedCustomerJSON } from "../access/bounded-customer-json";
import { withVerifiedNativeCustomerRead } from "../access/customer-session-transport";
import { verifyAddressSession } from "../addresses/address-transport";

type ReviewState =
  | { kind: "ready"; review: CustomerCheckoutReview }
  | { kind: "signed-out" | "unavailable" };

function unavailable(): ReviewState {
  return { kind: "unavailable" };
}

export async function readCheckoutReview(
  actor: string, store: string, input: CustomerCheckoutReviewInput, signal: AbortSignal,
): Promise<ReviewState> {
  if (signal.aborted) return unavailable();

  // DSH admits the same scalar snapshot at dispatch and at readback.
  const snapshot = Object.freeze({ ...input });
  if (!validCustomerCheckoutReviewInput(snapshot)) return unavailable();

  let interrupt!: () => void;
  const stopped = new Promise<ReviewState>(resolve => {
    interrupt = () => resolve(unavailable());
  });
  signal.addEventListener("abort", interrupt, { once: true });

  async function read(): Promise<ReviewState> {
    signal.throwIfAborted();
    if (Platform.OS === "web") {
      await verifyAddressSession(signal, actor);
      signal.throwIfAborted();
      const response = await fetch(`/api/customer-auth/checkout-review?storeId=${encodeURIComponent(store)}`, {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
        headers: { "Content-Type": "application/json", "X-Customer-Context": actor },
        body: JSON.stringify(snapshot),
      });
      if (signal.aborted || response.status !== 200 || response.headers.get("Cache-Control") !== "no-store") {
        discardCustomerResponse(response);
        signal.throwIfAborted();
        return response.status === 401 || response.status === 403 ? { kind: "signed-out" } : unavailable();
      }
      // The shared reader alone owns the accepted response body.
      const body = await readBoundedCustomerJSON({ headers: response.headers, body: response.body, signal }, 32 * 1024);
      signal.throwIfAborted();
      if (body === null) return unavailable();
      const review = parseCustomerCheckoutReview(body, store, actor, snapshot);
      await verifyAddressSession(signal, actor);
      signal.throwIfAborted();
      return { kind: "ready", review };
    }
    if (Platform.OS !== "android") return unavailable();
    const owner = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
    if (!owner) return unavailable();
    const result = await withVerifiedNativeCustomerRead(signal, bearer => {
      signal.throwIfAborted();
      return reviewCurrentCustomerCheckout(owner, bearer, actor, store, snapshot, signal);
    }, actor);
    signal.throwIfAborted();
    return result.kind === "ready" ? { kind: "ready", review: result.value } : result;
  }

  try {
    const result = await Promise.race([read(), stopped]);
    return signal.aborted ? unavailable() : result;
  } catch (error) {
    if (signal.aborted) return unavailable();
    return error instanceof DshPublicError && (error.status === 401 || error.status === 403)
      ? { kind: "signed-out" } : unavailable();
  } finally {
    signal.removeEventListener("abort", interrupt);
  }
}
