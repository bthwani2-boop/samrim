import { readNativeWallet } from "../wallet/wallet-read";
import { alignCheckoutFunding, type CheckoutFundingState } from "./checkout-funding-state";

// The native wallet SDK reads a current Identity Customer twice. Only the
// isolated Android emulator has a WLT endpoint; other platforms fail closed.
export async function readCheckoutFunding(
  cartActorId: string, signal: AbortSignal,
): Promise<CheckoutFundingState> {
  const result = await readNativeWallet(signal);
  signal.throwIfAborted();
  return alignCheckoutFunding(cartActorId, result);
}
