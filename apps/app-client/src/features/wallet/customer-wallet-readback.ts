import type { BeneficiaryWalletResponse } from "@bthwani/dsh";

/** Never display customer funds obtained for a different actor, role, or currency. */
export function isOwnCustomerWalletResponse(
  value: BeneficiaryWalletResponse,
  actorID: string,
): boolean {
  const normalized = actorID.trim();
  if (!normalized || !value || typeof value !== "object" || !value.state ||
      value.state.actorType !== "customer" || value.state.actorId !== normalized ||
      value.state.currency !== "YER" || !Array.isArray(value.fundingIntents)) {
    return false;
  }
  return value.fundingIntents.every((intent) =>
    intent && intent.actorType === "customer" && intent.actorId === normalized &&
    intent.fundingPurpose === "CUSTOMER_TOPUP" && intent.currency === "YER"
  );
}
