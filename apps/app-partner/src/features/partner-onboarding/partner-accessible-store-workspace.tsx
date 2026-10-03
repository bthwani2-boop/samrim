import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { PartnerAccessibleStore, StoreFulfillmentMode } from "@bthwani/dsh";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { StoreOfferManagement } from "../store-offer/store-offer";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { StoreOperationalAvailabilityManagement } from "./store-operational-availability";
import { usePartnerAccessibleStoreScopes } from "./partner-accessible-store-scopes";

function permissionLabels(store: PartnerAccessibleStore): string {
  const labels: Record<string, string> = { orders: "الطلبات", catalog: "الكتالوج", store_operations: "الإتاحة" };
  return store.permissions.map((permission) => labels[permission] ?? permission).join("، ");
}

function isStoreFulfillmentMode(value: string): value is StoreFulfillmentMode {
  return value === "BTHWANI_CAPTAIN" || value === "PARTNER_CAPTAIN" || value === "CUSTOMER_PICKUP";
}

export function PartnerAccessibleStoreWorkspace({ excludeOwned = false }: { excludeOwned?: boolean }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state, reload, loadMore } = usePartnerAccessibleStoreScopes();
  const [selectedStoreID, setSelectedStoreID] = useState("");
  const stores = state.kind === "ready" ? state.stores.filter((store) => !excludeOwned || !store.owned) : [];
  const selectedStore = stores.find((store) => store.id === selectedStoreID) ?? stores[0];

  if (state.kind === "loading") return <View style={styles.card}><ActivityIndicator accessibilityLabel="جارٍ قراءة المتاجر المتاحة للشريك" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المتاجر المملوكة والمفوّضة…</Text></View>;
  if (state.kind === "error") return <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة نطاقات المتاجر المتاحة من المنصة.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void reload()} variant="secondary" /></View>;

  return <View style={styles.card}>
    <Text style={styles.value}>{excludeOwned ? "متاجر مفوضة إليك" : "نطاقات المتاجر المتاحة"}</Text>
    <Text style={styles.muted}>تأتي القائمة والصلاحيات من DSH. يظهر لكل متجر فقط ما تملكه أو ما فوضه مالكه لحسابك.</Text>
    {stores.length === 0 ? <Text style={styles.muted}>{excludeOwned ? "لا توجد متاجر أخرى مفوضة إلى حسابك." : "لا توجد متاجر مملوكة أو مفوضة إلى حسابك حاليًا."}</Text> : null}
    {stores.map((store) => <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedStore?.id === store.id }} key={store.id} onPress={() => setSelectedStoreID(store.id)} style={{ backgroundColor: selectedStore?.id === store.id ? theme.surfaceInset : theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, padding: 12 }}>
      <Text style={styles.value}>{store.name}</Text>
      <Text style={styles.muted}>{store.owned ? "متجر تملكه" : "وصول مفوض"} · الصلاحيات: {permissionLabels(store)}</Text>
    </Pressable>)}
    {selectedStore ? <View style={{ gap: 12 }}>
      <Text selectable style={styles.metaLabel}>معرّف المتجر: {selectedStore.id}</Text>
      {selectedStore.permissions.includes("catalog") ? selectedStore.primaryVerticalId ? <StoreOfferManagement storeId={selectedStore.id} verticalId={selectedStore.primaryVerticalId} /> : <Text style={styles.muted}>لا يظهر نوع المتجر الكانوني، لذلك لم تُفتح إدارة العروض.</Text> : null}
      {selectedStore.permissions.includes("store_operations") ? <StoreOperationalAvailabilityManagement storeID={selectedStore.id} fulfillmentModes={selectedStore.fulfillmentModes.filter(isStoreFulfillmentMode)} /> : null}
      {selectedStore.permissions.includes("orders") ? <Text style={styles.muted}>إدارة الطلبات لهذا المتجر متاحة من تبويب «الطلبات» بعد اختياره هناك.</Text> : null}
    </View> : null}
    {state.nextCursor ? <BthwaniButton label="تحميل متاجر أخرى" onPress={() => void loadMore()} variant="secondary" /> : null}
  </View>;
}
