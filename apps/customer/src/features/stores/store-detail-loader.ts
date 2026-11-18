import type { PublicOffer, PublicPage, PublicStore } from "@bthwani/dsh";

export interface PublicStoreDetailResult {
  store: PublicStore;
  offers: PublicOffer[];
  nextCursor?: string | undefined;
  offersError?: string;
}

export interface PublicStoreDetailState {
  scope: string;
  loading: boolean;
  store?: PublicStore | undefined;
  offers: PublicOffer[];
  cursor?: string | undefined;
  more?: boolean;
  error?: string | undefined;
  offersError?: string | undefined;
}

// A publication denial invalidates the entire public projection. A stale
// cursor invalidates cached Offers; only transport failures retain prior data.
export function recoverPublicStoreDetail(state: PublicStoreDetailState, reason: unknown): PublicStoreDetailState {
  const error = reason instanceof Error ? reason.message : "UNKNOWN";
  if (error === "NOT_FOUND") return { scope: state.scope, loading: false, offers: [], error };
  if (error === "STALE_CURSOR" || error === "INVALID_CURSOR") {
    return { ...state, more: false, offers: [], cursor: undefined, offersError: error };
  }
  return { ...state, more: false, offersError: error };
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
    (reason: unknown) => {
      if (reason instanceof Error && reason.message === "NOT_FOUND") throw reason;
      return { page: undefined, error: reason instanceof Error ? reason.message : "UNKNOWN" };
    },
  );
  const [store, outcome] = await Promise.all([storeRequest, offersOutcome]);
  if (!outcome.page) return { store, offers: [], offersError: outcome.error };
  return {
    store,
    offers: outcome.page.items,
    nextCursor: outcome.page.nextCursor,
  };
}
