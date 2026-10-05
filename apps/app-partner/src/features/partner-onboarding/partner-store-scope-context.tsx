import type { PartnerAccessibleStore, StoreAccessPermission } from "@bthwani/dsh";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { usePartnerAccessibleStoreScopes } from "./partner-accessible-store-scopes";

type PartnerStoreScopeContextValue = Readonly<{
  state: ReturnType<typeof usePartnerAccessibleStoreScopes>["state"];
  selectedStore: PartnerAccessibleStore | undefined;
  selectedStoreID: string;
  selectStore: (storeID: string) => void;
  stores: ReadonlyArray<PartnerAccessibleStore>;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  storesWithPermission: (permission: StoreAccessPermission) => ReadonlyArray<PartnerAccessibleStore>;
}>;

const PartnerStoreScopeContext = createContext<PartnerStoreScopeContextValue | null>(null);

export function PartnerStoreScopeProvider({ children }: { children: ReactNode }) {
  const scopes = usePartnerAccessibleStoreScopes();
  const [selectedStoreID, setSelectedStoreID] = useState("");
  const stores = scopes.state.kind === "ready" ? scopes.state.stores : [];

  useEffect(() => {
    if (stores.length === 0) {
      if (selectedStoreID) setSelectedStoreID("");
      return;
    }
    if (selectedStoreID && stores.some((store) => store.id === selectedStoreID)) return;
    setSelectedStoreID((stores.find((store) => store.owned) ?? stores[0]).id);
  }, [selectedStoreID, stores]);

  const value = useMemo<PartnerStoreScopeContextValue>(() => ({
    state: scopes.state,
    stores,
    selectedStoreID,
    selectedStore: stores.find((store) => store.id === selectedStoreID) ?? stores.find((store) => store.owned) ?? stores[0],
    selectStore: setSelectedStoreID,
    reload: scopes.reload,
    loadMore: scopes.loadMore,
    storesWithPermission: (permission) => stores.filter((store) => store.owned || store.permissions.includes(permission)),
  }), [scopes.state, scopes.reload, scopes.loadMore, selectedStoreID, stores]);

  return <PartnerStoreScopeContext.Provider value={value}>{children}</PartnerStoreScopeContext.Provider>;
}

export function usePartnerStoreScope(): PartnerStoreScopeContextValue {
  const value = useContext(PartnerStoreScopeContext);
  if (!value) throw new Error("PARTNER_STORE_SCOPE_PROVIDER_REQUIRED");
  return value;
}
