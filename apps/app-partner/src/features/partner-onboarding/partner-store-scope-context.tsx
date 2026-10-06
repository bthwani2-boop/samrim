import { type PartnerAccessibleStore, type StoreAccessPermission } from "@bthwani/dsh";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { usePartnerAccessibleStoreScopes } from "./partner-accessible-store-scopes";
import { type PartnerAuthority, derivePartnerAuthority, RESOLVING_PARTNER_AUTHORITY } from "../../shell/partner-authority";

export type { PartnerAccessibleStore };

export type { PartnerAuthority };

type PartnerStoreScopeContextValue = Readonly<{
  state: ReturnType<typeof usePartnerAccessibleStoreScopes>["state"];
  authority: PartnerAuthority;
  selectedStore: PartnerAccessibleStore | undefined;
  selectedStoreID: string;
  selectStore: (storeID: string) => void;
  stores: ReadonlyArray<PartnerAccessibleStore>;
  reload: () => Promise<void>;
  storesWithPermission: (permission: StoreAccessPermission) => ReadonlyArray<PartnerAccessibleStore>;
}>;

const PartnerStoreScopeContext = createContext<PartnerStoreScopeContextValue | null>(null);

export function PartnerStoreScopeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const scopes = usePartnerAccessibleStoreScopes();
  const [selectedStoreID, setSelectedStoreID] = useState("");
  const stores = scopes.state.kind === "ready" ? scopes.state.stores : [];
  const authority = useMemo(() => (scopes.state.kind === "ready" ? derivePartnerAuthority(scopes.state.stores) : RESOLVING_PARTNER_AUTHORITY), [scopes.state]);

  useEffect(() => {
    if (stores.length === 0) {
      if (selectedStoreID) setSelectedStoreID("");
      return;
    }
    if (selectedStoreID && stores.some((store) => store.id === selectedStoreID)) return;
    const defaultStore = stores.find((store) => store.owned) ?? stores[0];
    if (defaultStore) setSelectedStoreID(defaultStore.id);
  }, [selectedStoreID, stores]);

  const value = useMemo<PartnerStoreScopeContextValue>(() => ({
    state: scopes.state,
    authority,
    stores,
    selectedStoreID,
    selectedStore: stores.find((store) => store.id === selectedStoreID) ?? stores.find((store) => store.owned) ?? stores[0],
    selectStore: setSelectedStoreID,
    reload: scopes.reload,
    storesWithPermission: (permission) => stores.filter((store) => store.owned || store.permissions.includes(permission)),
  }), [scopes.state, authority, scopes.reload, selectedStoreID, stores]);

  return <PartnerStoreScopeContext.Provider value={value}>{children}</PartnerStoreScopeContext.Provider>;
}

export function usePartnerStoreScope(): PartnerStoreScopeContextValue {
  const value = useContext(PartnerStoreScopeContext);
  if (!value) throw new Error("PARTNER_STORE_SCOPE_PROVIDER_REQUIRED");
  return value;
}
