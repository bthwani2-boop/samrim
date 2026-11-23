/** A public path is not a Store grant, publication command or checkout link. */
const canonicalStoreId = /^[a-z0-9-]{1,64}$/;

export function publicStorefrontLink(storeId: string, configuredOrigin?: string): string | null {
  if (!canonicalStoreId.test(storeId)) return null;
  // Sharing requires the Customer public origin; a relative Merchant URL
  // would silently direct customers to the wrong application.
  if (!configuredOrigin) return null;
  const path = `/storefront/${storeId}`;
  let root: URL;
  try { root = new URL(configuredOrigin); }
  catch { return null; }
  if (root.username || root.password || (root.pathname !== "/" && root.pathname !== "") ||
      root.search || root.hash ||
      !(root.protocol === "https:" ||
        (root.protocol === "http:" && ["localhost", "127.0.0.1"].includes(root.hostname)))) {
    return null;
  }
  return new URL(path, root).href;
}
