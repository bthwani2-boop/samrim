import { readPublicStoreId } from "../location/serviceability.ts";

/** Public links never confer Store ownership, access or checkout permissions. */
export function publicStorefrontPath(storeId: string): string {
  const id = readPublicStoreId(storeId);
  return id === null ? "/stores" : `/storefront/${id}`;
}
