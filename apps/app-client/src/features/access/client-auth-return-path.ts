// Only known in-app destinations may survive the signed-out authentication boundary.
export const clientAuthReturnPathPattern = /^\/(?:home|notifications|account|wallet|wallet-cash-in(?:\?(?:amountMinor=[1-9][0-9]{0,14}(?:&fromCheckout=1)?|fromCheckout=1))?|addresses|multi-store-checkout|orders(?:\/[A-Za-z0-9._~%-]+)?|store\/[A-Za-z0-9._~%-]+(?:\?productId=[A-Za-z0-9._~%-]+)?|cart\/[A-Za-z0-9._~%-]+)$/u;

// Preserve a checkout funding shortfall without trusting arbitrary URL parameters.
export function clientWalletCashInAuthReturnPath(
  amountMinor: string | string[] | undefined,
  fromCheckout: string | string[] | undefined,
): string {
  const rawAmount = Array.isArray(amountMinor) ? amountMinor[0] : amountMinor;
  const rawOrigin = Array.isArray(fromCheckout) ? fromCheckout[0] : fromCheckout;
  const amount = typeof rawAmount === "string" && /^[1-9][0-9]{0,14}$/u.test(rawAmount) &&
    Number.isSafeInteger(Number(rawAmount)) ? String(Number(rawAmount)) : "";
  const query = [amount ? `amountMinor=${amount}` : "", rawOrigin === "1" ? "fromCheckout=1" : ""].filter(Boolean).join("&");
  return `/wallet-cash-in${query ? "?" + query : ""}`;
}
