import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { PartnerAccessibleStore, StoreAccessPermission } from "@bthwani/dsh";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { usePartnerStoreScope } from "./partner-store-scope-context";

function permissionLabels(store: PartnerAccessibleStore): string {
  if (store.owned) return "مالك المتجر";
  const labels: Record<string, string> = {
    orders: "الطلبات",
    catalog: "الكتالوج",
    store_operations: "إتاحة المتجر وساعاته",
    promotions: "العروض والتخفيضات",
    finance_read: "قراءة المالية",
    payout_request: "طلب صرف المستحقات",
    fulfillment: "التوصيل والاستلام",
  };
  return store.permissions.map((permission) => labels[permission] ?? permission).join("، ");
}

export function PartnerStoreScopeSelector({ requiredPermissions }: Readonly<{ requiredPermissions?: ReadonlyArray<StoreAccessPermission> }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state, stores, selectedStore, selectStore, reload, loadMore } = usePartnerStoreScope();
  const visibleStores = requiredPermissions
    ? stores.filter((store) => store.owned || requiredPermissions.some((permission) => store.permissions.includes(permission)))
    : stores;

  if (state.kind === "loading") return <View style={styles.card}><ActivityIndicator accessibilityLabel="جارٍ قراءة المتاجر المتاحة" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المتاجر المتاحة لحسابك…</Text></View>;
  if (state.kind === "error") return <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة المتاجر المتاحة من المنصة.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void reload()} variant="secondary" /></View>;

  return <View style={styles.card}>
    <Text style={styles.value}>اختر المتجر</Text>
    <Text style={styles.muted}>سيبقى المتجر المختار نفسه أثناء انتقالك بين أقسام التطبيق.</Text>
    {visibleStores.length === 0 ? <Text style={styles.muted}>لا يوجد متجر متاح لهذه العملية حاليًا.</Text> : null}
    {visibleStores.map((store) => <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedStore?.id === store.id }} key={store.id} onPress={() => selectStore(store.id)} style={{ backgroundColor: selectedStore?.id === store.id ? theme.surfaceInset : theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, padding: 12 }}>
      <Text style={styles.value}>{store.name}</Text>
      <Text style={styles.muted}>{permissionLabels(store)}</Text>
    </Pressable>)}
    {state.kind === "ready" && state.nextCursor ? <BthwaniButton label="تحميل متاجر أخرى" onPress={() => void loadMore()} variant="secondary" /> : null}
  </View>;
}
