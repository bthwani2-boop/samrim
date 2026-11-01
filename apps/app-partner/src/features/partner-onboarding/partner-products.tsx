import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { Button, Host } from "@expo/ui";
import { useMobileAppearance } from "@bthwani/design-system/native";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { StoreOfferManagement } from "../store-offer/store-offer";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

export function PartnerProducts() {
  const { theme, themeName } = useMobileAppearance();
  const router = useRouter();
  const { panel: rawPanel } = useLocalSearchParams<{ panel?: string }>();
  const toolsView = rawPanel === "tools";
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { selectedStore, stores, selectStore, state } = usePartnerStoreScope();
  const permittedStores = useMemo(() => stores.filter((store) => store.owned || store.permissions.includes("catalog")), [stores]);
  const catalogStore = selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")) ? selectedStore : undefined;
  const switchingStore = state.kind === "ready" && !catalogStore && permittedStores.length > 0;

  useEffect(() => {
    if (state.kind !== "ready" || catalogStore) return;
    const next = permittedStores[0];
    if (next && next.id !== selectedStore?.id) selectStore(next.id);
  }, [state.kind, catalogStore, permittedStores, selectedStore?.id, selectStore]);

  return <View style={styles.container}>
    {toolsView ? <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}><Button label="العودة إلى المنتجات" onPress={() => router.replace("/products" as Href)} testID="partner-products-back-to-list" variant="outlined" /></Host> : null}
    {switchingStore ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ فتح المتجر المصرح" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ فتح متجر مصرح لك بإدارة منتجاته…</Text></View> : null}
    {catalogStore?.primaryVerticalId ? <StoreOfferManagement key={catalogStore.id} storeId={catalogStore.id} serviceCityId={catalogStore.serviceCityId} storePublicationState={catalogStore.publicationState} canManagePromotions={catalogStore.owned || catalogStore.permissions.includes("promotions")} verticalId={catalogStore.primaryVerticalId} toolsView={toolsView} /> : null}
    {state.kind === "ready" && permittedStores.length === 0 ? <Text accessibilityRole="alert" style={styles.muted}>لا توجد متاجر تملك صلاحية إدارة منتجاتها.</Text> : null}
    {catalogStore && !catalogStore.primaryVerticalId ? <Text style={styles.muted}>تصنيف المتجر غير مكتمل.</Text> : null}
  </View>;
}
