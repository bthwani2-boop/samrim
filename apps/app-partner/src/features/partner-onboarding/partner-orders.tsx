import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { PartnerAccessibleStore } from "@bthwani/dsh";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { OrderManagement } from "../order-management/order-management";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { usePartnerAccessibleStoreScopes } from "./partner-accessible-store-scopes";

function scopeSummary(store: PartnerAccessibleStore): string {
  return `${store.owned ? "متجر تملكه" : "وصول مفوض"} · ${store.permissions.includes("orders") ? "إدارة الطلبات متاحة" : "بلا صلاحية للطلبات"}`;
}

export function PartnerOrders() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state, reload, loadMore } = usePartnerAccessibleStoreScopes();
  const [selectedStoreID, setSelectedStoreID] = useState("");
  const stores = state.kind === "ready" ? state.stores.filter((store) => store.permissions.includes("orders")) : [];
  const selectedStore = stores.find((store) => store.id === selectedStoreID) ?? stores.find((store) => store.owned) ?? stores[0];

  if (state.kind === "loading") return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة متاجر الشريك" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المتاجر وصلاحيات الطلبات…</Text></View>;
  if (state.kind === "error") return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة نطاقات المتاجر.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void reload()} variant="secondary" /></View>;

  return <View style={styles.container}>
    <Text style={styles.sectionTitle}>طلبات المتاجر</Text>
    <Text style={styles.muted}>اختر المتجر المطلوب. يحدد DSH نطاق كل طلب وصلاحية حسابك عند قراءة العمليات وتنفيذها.</Text>
    {stores.length === 0 ? <View style={styles.card}><Text style={styles.muted}>لا يوجد متجر لديك صلاحية «الطلبات» عليه في الصفحات المحملة.</Text>{state.nextCursor ? <BthwaniButton label="تحميل متاجر أخرى" onPress={() => void loadMore()} variant="secondary" /> : null}</View> : null}
    {stores.map((store) => <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedStore?.id === store.id }} key={store.id} onPress={() => setSelectedStoreID(store.id)} style={{ backgroundColor: selectedStore?.id === store.id ? theme.surfaceInset : theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, padding: 12 }}>
      <Text style={styles.value}>{store.name}</Text>
      <Text style={styles.muted}>{scopeSummary(store)}</Text>
    </Pressable>)}
    {selectedStore ? <View style={styles.card}>
      <Text style={styles.value}>{selectedStore.name}</Text>
      <Text selectable style={styles.metaLabel}>معرّف المتجر: {selectedStore.id}</Text>
      <OrderManagement key={selectedStore.id} owned={selectedStore.owned} storeId={selectedStore.id} />
    </View> : null}
    {state.nextCursor ? <BthwaniButton label="تحميل متاجر أخرى" onPress={() => void loadMore()} variant="secondary" /> : null}
  </View>;
}
