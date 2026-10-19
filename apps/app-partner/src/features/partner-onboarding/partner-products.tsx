import { BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { StoreOfferManagement } from "../store-offer/store-offer";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

export function PartnerProducts() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { selectedStore, stores, selectStore, state } = usePartnerStoreScope();
  const permittedStores = stores.filter((store) => store.owned || store.permissions.includes("catalog"));
  const canCatalog = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")));

  useEffect(() => {
    if (state.kind !== "ready" || canCatalog) return;
    const next = permittedStores[0];
    if (next && next.id !== selectedStore?.id) selectStore(next.id);
  }, [state.kind, canCatalog, permittedStores, selectedStore?.id, selectStore]);

  return <View style={styles.container}>
    <Text style={styles.sectionTitle}>المنتجات</Text>
    {permittedStores.length > 1 || !canCatalog ? <PartnerStoreScopeSelector requiredPermissions={["catalog"]} /> : null}
    {selectedStore && canCatalog ? <>
      <View style={styles.headerRow}>
        <Text style={styles.value}>{selectedStore.name}</Text>
        <BthwaniStatusBadge icon={selectedStore.publicationState === "published" ? "success" : "warning"} label={selectedStore.publicationState === "published" ? "منشور" : "غير منشور"} tone={selectedStore.publicationState === "published" ? "success" : "warning"} />
      </View>
      {selectedStore.primaryVerticalId
        ? <StoreOfferManagement key={selectedStore.id} storeId={selectedStore.id} verticalId={selectedStore.primaryVerticalId} />
        : <View style={styles.card}><Text style={styles.muted}>لا يتوفر تصنيف نشاط معتمد لهذا المتجر. لا يمكن إدارة المنتجات حتى يكتمل التصنيف.</Text></View>}
    </> : null}
  </View>;
}
