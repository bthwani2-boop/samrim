import type { PublicOffer, PublicPage, PublicStore } from "@bthwani/dsh";
import { publicFailureCode, retainsPublicContinuation } from "../discovery/public-page";

export interface PublicStoreDetailResult {
  store: PublicStore;
  offers: PublicOffer[];
  nextCursor?: string | undefined;
  offersRevision?: number;
  offersError?: string;
}

export interface PublicStoreDetailState {
  scope: string;
  loading: boolean;
  store?: PublicStore | undefined;
  offers: PublicOffer[];
  offersRevision?: number | undefined;
  cursor?: string | undefined;
  more?: boolean;
  error?: string | undefined;
  offersError?: string | undefined;
}

type OffersOutcome =
  | { kind: "verified"; page: PublicPage<PublicOffer> }
  | { kind: "failed"; code: string };


// Only an explicit temporary outage permits retrying a previously verified
// continuation. Any other failure requires a fresh Offer snapshot.
export function recoverPublicStoreDetail(
  state: PublicStoreDetailState,
  reason: unknown,
): PublicStoreDetailState {
  const code = publicFailureCode(reason);
  const empty = { scope: state.scope, loading: false, offers: [] };
  if (code === "NOT_FOUND") return { ...empty, error: code };

  if (retainsPublicContinuation(code)) {
    return { ...state, more: false, offersError: code };
  }

  return { ...empty, store: state.store, more: false, offersError: code };
}

// The Store and its first Offer page are separate owner reads. Observe both
// immediately: publication denial on either read must not wait for the other.
export async function resolvePublicStoreDetail(
  storeRequest: Promise<PublicStore>,
  offersRequest: Promise<PublicPage<PublicOffer>>,
): Promise<PublicStoreDetailResult> {
  const offersOutcome = offersRequest.then<OffersOutcome, OffersOutcome>(
    (page) => ({ kind: "verified", page }),
    (reason: unknown) => {
      const code = publicFailureCode(reason);
      if (code === "NOT_FOUND") throw reason;
      return { kind: "failed", code };
    },
  );

  const [store, outcome] = await Promise.all([storeRequest, offersOutcome]);
  if (outcome.kind === "failed") {
    return { store, offers: [], offersError: outcome.code };
  }

  const { items, nextCursor, revision } = outcome.page;
  return { store, offers: items, nextCursor, offersRevision: revision };
}
