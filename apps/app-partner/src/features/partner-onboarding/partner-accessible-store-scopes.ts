import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import type { PartnerAccessibleStore } from "@bthwani/dsh";
import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";
import { listPartnerAccessibleStores } from "./store-readback-client";

type StoreScopesState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PartnerAccessibleStore> }
  | { kind: "error" };

// Permission-bearing Store scopes are cached per Identity actor AND session,
// not per browser/device or subject alone. Do not persist this cache to disk.
export function usePartnerAccessibleStoreScopes() {
  const [sessionScope,setSessionScope]=useState(()=>partnerSetupSessionKey(currentIdentityState()));
  useEffect(()=>{
    const sync=()=>setSessionScope(partnerSetupSessionKey(currentIdentityState()));
    const unsubscribe=subscribeIdentitySession(sync);
    sync();
    return unsubscribe;
  },[]);
  const stillCurrent=()=>Boolean(sessionScope)&&partnerSetupSessionKey(currentIdentityState())===sessionScope;
  const scopes = useQuery({
    queryKey: ["partner", "accessible-stores", sessionScope],
    enabled: stillCurrent(),
    queryFn: async ({ signal }) => {
      const ensureCurrent=()=>{
        if(signal.aborted||!stillCurrent())throw new Error("PARTNER_STORE_SCOPE_CANCELLED");
      };
      const stores: PartnerAccessibleStore[] = [];
      const seenStoreIDs = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor = "";
      do {
        ensureCurrent();
        const page = await listPartnerAccessibleStores(cursor);
        ensureCurrent();
        if (!Array.isArray(page.stores) || page.stores.length > 50 || typeof page.nextCursor !== "string") {
          throw new Error("PARTNER_STORE_SCOPE_INVALID_PAGE");
        }
        for (const store of page.stores) {
          if (typeof store?.id !== "string" || !store.id || seenStoreIDs.has(store.id)) {
            throw new Error("PARTNER_STORE_SCOPE_INVALID_PAGE");
          }
          seenStoreIDs.add(store.id);
        }
        // DSH orders by Store ID and uses the final returned ID as its cursor.
        // Reject cycles, duplicates and incomplete pages before exposing any rights.
        if (page.nextCursor) {
          if (page.nextCursor !== page.stores.at(-1)?.id || seenCursors.has(page.nextCursor) || seenCursors.size >= 1000) {
            throw new Error("PARTNER_STORE_SCOPE_INVALID_PAGE");
          }
          seenCursors.add(page.nextCursor);
        }
        stores.push(...page.stores);
        cursor = page.nextCursor;
      } while (cursor);
      return stores;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const reload = useCallback(async () => {
    if(sessionScope&&partnerSetupSessionKey(currentIdentityState())===sessionScope)await scopes.refetch();
  }, [scopes.refetch,sessionScope]);

  const state: StoreScopesState = !stillCurrent() || scopes.isPending || scopes.isFetching
    ? { kind: "loading" }
    : scopes.isError ? { kind: "error" }
    : { kind: "ready", stores: scopes.data ?? [] };
  return { state, reload };
}
