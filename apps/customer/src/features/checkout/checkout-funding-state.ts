import type { CustomerWalletBalance } from "@bthwani/wlt";

export type CheckoutFundingState =
  | { kind: "ready"; balance: CustomerWalletBalance; expiresAt: number }
  | { kind: "signed-out" | "unavailable" };

type WalletEvidence = CheckoutFundingState;

// Read-only WLT evidence is usable in the checkout review only for the
// same verified Customer who owns the DSH cart, and only while current.
// This never authorizes a hold, debit, quote or Order.
export function alignCheckoutFunding(
  cartActorId: string, evidence: WalletEvidence, now = Date.now(),
): CheckoutFundingState {
  if (evidence.kind !== "ready") return evidence;
  if (evidence.balance.actorId !== cartActorId ||
    !Number.isFinite(evidence.expiresAt) || evidence.expiresAt <= now) {
    return { kind: "signed-out" };
  }
  return evidence;
}
