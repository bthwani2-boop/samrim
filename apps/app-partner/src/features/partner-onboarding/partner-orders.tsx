import { useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { OrderManagement } from "../order-management/order-management";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";

export function PartnerOrders() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state, selectedStore } = usePartnerStoreScope();
  const canManageOrders = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("orders")));

  return <View style={styles.container}>
    <Text style={styles.sectionTitle}>الطلبات</Text>
    <PartnerStoreScopeSelector requiredPermission="orders" />
    {state.kind === "ready" && selectedStore && !canManageOrders ? <View style={styles.card}><Text style={styles.muted}>المتجر المختار حاليًا لا يمنح هذا الحساب صلاحية إدارة الطلبات. اختر متجرًا آخر من القائمة أعلاه.</Text></View> : null}
    {selectedStore && canManageOrders ? <View style={styles.card}>
      <Text style={styles.value}>{selectedStore.name}</Text>
      <OrderManagement key={selectedStore.id} owned={selectedStore.owned} storeId={selectedStore.id} />
    </View> : null}
  </View>;
}
