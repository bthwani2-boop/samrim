// A recovery record belongs to exactly one authenticated operator in this browser tab.
export function operatorRecoveryStorageKey(base: string, operatorActorId: string): string | null {
  const actor = operatorActorId.trim();
  return actor ? base + ":" + encodeURIComponent(actor) : null;
}

// Distinct payments must retain distinct retry identities when an operator
// switches between interrupted financial workflows in the same browser tab.
export function operatorPaymentRecoveryStorageKey(base: string, operatorActorId: string, paymentIntentId: string): string | null {
  const payment = paymentIntentId.trim();
  return payment && payment.length <= 128
    ? operatorRecoveryStorageKey(base + ":" + encodeURIComponent(payment), operatorActorId)
    : null;
}
