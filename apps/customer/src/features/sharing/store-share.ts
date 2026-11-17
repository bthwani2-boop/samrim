/** Public links never confer Store ownership, access or checkout permissions. */
export function publicStorefrontPath(storeId: string): string {
  const value = storeId.trim();
  const hasControlCharacter = [...value].some((character) => character.charCodeAt(0) < 32);
  if (!value || value.length > 120 || value.includes("/") || value.includes("\\") || hasControlCharacter || value === "." || value === "..") return "/stores";
  return `/storefront/${encodeURIComponent(value)}`;
}
