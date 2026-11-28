import { publicStorefrontPath as canonicalPublicStorefrontPath, publicStorefrontUrl } from "@bthwani/dsh";

/** Navigation recovers to the directory if the route identifier is invalid. */
export function publicStorefrontPath(storeId: string): string {
  return canonicalPublicStorefrontPath(storeId) ?? "/stores";
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
  const url = publicStorefrontUrl(storeId, origin);
  if (!url) return null;
  const current = await read(storeId, signal);
  signal.throwIfAborted();
  if (current.id !== storeId) throw new Error("Unexpected public Store");
  return url;
}
