import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import type { PartnerAccessibleStore } from "@bthwani/dsh";
import { listPartnerAccessibleStores } from "./store-readback-client";

type StoreScopesState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PartnerAccessibleStore> }
  | { kind: "error" };

// The provider belongs to the currently signed-in actor and is destroyed on
// session changes. Do not persist this permission-bearing cache to disk.
export function usePartnerAccessibleStoreScopes() {
  const scopes = useQuery({
    queryKey: ["partner", "accessible-stores"],
    queryFn: async ({ signal }) => {
      const stores: PartnerAccessibleStore[] = [];
      let cursor = "";
      do {
        if (signal.aborted) throw new Error("PARTNER_STORE_SCOPE_CANCELLED");
        const page = await listPartnerAccessibleStores(cursor);
        if (signal.aborted) throw new Error("PARTNER_STORE_SCOPE_CANCELLED");
        stores.push(...page.stores);
        cursor = page.nextCursor;
      } while (cursor);
      return stores;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const reload = useCallback(async () => {
    await scopes.refetch();
  }, [scopes.refetch]);

  const state: StoreScopesState = scopes.isPending || scopes.isFetching
    ? { kind: "loading" }
    : scopes.isError ? { kind: "error" }
    : { kind: "ready", stores: scopes.data ?? [] };
  return { state, reload };
}
