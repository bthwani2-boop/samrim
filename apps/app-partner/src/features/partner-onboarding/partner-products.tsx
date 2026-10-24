import { useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useMemo } from "react";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { BthwaniButton } from "@bthwani/design-system/native";
import { Text, View } from "react-native";
import { StoreOfferManagement } from "../store-offer/store-offer";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

export function PartnerProducts() {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const { panel: rawPanel } = useLocalSearchParams<{ panel?: string }>();
  const toolsView = rawPanel === "tools";
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
    {permittedStores.length > 1 ? <PartnerStoreScopeSelector requiredPermissions={["catalog"]} /> : null}
    {toolsView ? <BthwaniButton label="العودة إلى المنتجات" variant="secondary" onPress={() => router.replace("/products" as Href)} /> : null}
    {selectedStore && canCatalog && selectedStore.primaryVerticalId ? <StoreOfferManagement key={selectedStore.id} storeId={selectedStore.id} serviceCityId={selectedStore.serviceCityId} canManagePromotions={selectedStore.owned || selectedStore.permissions.includes("promotions")} verticalId={selectedStore.primaryVerticalId} toolsView={toolsView} /> : null}
    {state.kind === "ready" && !canCatalog ? <Text style={styles.muted}>لا تتوفر صلاحية المنتجات لهذا المتجر.</Text> : null}
    {selectedStore && canCatalog && !selectedStore.primaryVerticalId ? <Text style={styles.muted}>تصنيف المتجر غير مكتمل.</Text> : null}
  </View>;
}
