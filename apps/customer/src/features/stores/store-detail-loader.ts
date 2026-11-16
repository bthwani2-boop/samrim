import type { PublicOffer, PublicPage, PublicStore } from "@bthwani/dsh";

export interface PublicStoreDetailResult {
  store: PublicStore;
  offers: PublicOffer[];
  nextCursor?: string | undefined;
  offersError?: string;
}

// Store identity/publication is mandatory; offers are an independent read.
// A transient Offers failure must not erase a successfully verified Store.
export async function resolvePublicStoreDetail(
  storeRequest: Promise<PublicStore>,
  offersRequest: Promise<PublicPage<PublicOffer>>,
): Promise<PublicStoreDetailResult> {
  // Attach both handlers immediately so a rejected Offers read never leaks an
  // unhandled rejection, while a forbidden Store can fail without waiting for it.
  const offersOutcome = offersRequest.then(
    (page) => ({ page, error: undefined }),
    (reason: unknown) => ({
      page: undefined,
      error: reason instanceof Error ? reason.message : "UNKNOWN",
    }),
  );
  const store = await storeRequest;
  const outcome = await offersOutcome;
  if (!outcome.page) return { store, offers: [], offersError: outcome.error };
  return {
    store,
    offers: outcome.page.items,
    nextCursor: outcome.page.nextCursor,
  };
}
