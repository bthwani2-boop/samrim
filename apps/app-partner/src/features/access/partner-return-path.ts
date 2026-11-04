// Return navigation is scoped to admitted Partner surfaces. Only product-list
// filters are preserved across sign-in; never forward arbitrary query strings.
export const partnerReturnPathPattern =
  /^(?:\/(?:store|notifications|orders|wallet|more|account|onboarding)|\/products(?:\?filter=(?:all|popular|offers|published|unavailable|hidden|stockout))?)$/u;

export function partnerReturnPath(pathname: string, filter: string | string[] | undefined): string {
  const requested = typeof filter === "string" ? filter : undefined;
  const filteredPath = `${pathname}?filter=${requested}`;
  return pathname === "/products" && requested && partnerReturnPathPattern.test(filteredPath)
    ? filteredPath : pathname;
}
