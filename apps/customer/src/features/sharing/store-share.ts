import { readPublicStoreId } from "../location/serviceability.ts";

/** Public links never confer Store ownership, access or checkout permissions. */
export function publicStorefrontPath(storeId: string): string {
  const id = readPublicStoreId(storeId);
  return id === null ? "/stores" : `/storefront/${id}`;
}

export function publicStorefrontShareUrl(storeId: string, origin: string): string | null {
  if (readPublicStoreId(storeId) === null || !origin) return null;
  try {
    const root = new URL(origin);
    if (root.username || root.password || root.pathname !== "/" || root.search || root.hash ||
      !(root.protocol === "https:" ||
        (root.protocol === "http:" && ["localhost", "127.0.0.1"].includes(root.hostname)))) return null;
    return new URL(publicStorefrontPath(storeId), root).href;
  } catch {
    return null;
  }
}

/** A rendered Store is not enduring publication authority. Recheck immediately
 * before sharing and return only the canonical public URL, not owner data. */
export async function verifyStorefrontShare(
  storeId: string,
  origin: string,
  read: (id: string, signal: AbortSignal) => Promise<Readonly<{ id: string }>>,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  const url = publicStorefrontShareUrl(storeId, origin);
  if (!url) return null;
  const current = await read(storeId, signal);
  signal.throwIfAborted();
  if (current.id !== storeId) throw new Error("Unexpected public Store");
  return url;
}
