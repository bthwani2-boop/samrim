const scopedID = "[A-Za-z0-9_-]{1,150}";
const scopedIDPattern = new RegExp(`^${scopedID}$`, "u");
const storeCity = `serviceCityId=${scopedID}(?:&productId=[A-Za-z0-9._~%-]{1,450})?`;
const existingRoutes = /home|notifications|account|wallet|wallet-cash-in(?:\?(?:amountMinor=[1-9][0-9]{0,14}(?:&fromCheckout=1)?|fromCheckout=1))?|addresses|multi-store-checkout|orders(?:\/[A-Za-z0-9._~%-]+)?|store\/[A-Za-z0-9._~%-]+(?:\?productId=[A-Za-z0-9._~%-]+)?|cart\/[A-Za-z0-9._~%-]+/u;

// Only known in-app destinations and explicit commerce scope survive authentication.
export const clientAuthReturnPathPattern = new RegExp(
  String.raw`^/(?:${existingRoutes.source}|store/${scopedID}\?${storeCity}|storefront/${scopedID}\?${storeCity}|cart/${scopedID}\?source=storefront&${storeCity})$`,
  "u",
);

export function clientStorefrontCartScope(
  storeID: string,
  source: string | string[] | undefined,
  cityID: string | string[] | undefined,
  productID: string | string[] | undefined,
): { cityID: string; productID: string; returnPath: string } | null {
  if (source !== "storefront" || typeof cityID !== "string" ||
      !scopedIDPattern.test(storeID) || !scopedIDPattern.test(cityID) || Array.isArray(productID)) return null;
  const product = productID ?? "";
  const returnPath = `/cart/${storeID}?source=storefront&serviceCityId=${cityID}` +
    (product ? `&productId=${encodeURIComponent(product)}` : "");
  return clientAuthReturnPathPattern.test(returnPath) ? { cityID, productID: product, returnPath } : null;
}

export function clientStorefrontCartPath(storeID: string, cityID: string, productID: string): string {
  return clientStorefrontCartScope(storeID, "storefront", cityID, productID)?.returnPath ??
    `/cart/${encodeURIComponent(storeID)}`;
}

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

/** Return to the requested Order after sign-in without trusting a raw route. */
export function clientOrderAuthenticationReturnPath(orderID: string): string {
  const normalizedOrderID = orderID.trim();
  return normalizedOrderID ? `/orders/${encodeURIComponent(normalizedOrderID)}` : "/orders";
}
