import { readCustomerAdmission } from "../access/customer-session-transport";
import { readVerifiedWallet } from "../wallet/wallet-read.web";
import { alignCheckoutFunding, type CheckoutFundingState } from "./checkout-funding-state";

// WLT balance is independent of the DSH cart. Both owners recheck Identity;
// matching the same actor prevents a cross-account financial preview.
export async function readCheckoutFunding(
  cartActorId: string, signal: AbortSignal,
): Promise<CheckoutFundingState> {
  const result = await readVerifiedWallet(readCustomerAdmission, signal, cartActorId);
  signal.throwIfAborted();
  return alignCheckoutFunding(cartActorId, result);
}
