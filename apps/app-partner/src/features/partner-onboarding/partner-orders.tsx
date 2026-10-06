import { BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { OrderManagement } from "../order-management/order-management";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";

type OrdersScope = "SELECTED_STORE" | "ALL_AUTHORIZED";

export function PartnerOrders() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state, stores, selectedStore } = usePartnerStoreScope();
  const [scope, setScope] = useState<OrdersScope>("SELECTED_STORE");
  const canManageOrders = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("orders")));
  const hasAnyAuthorizedStore = stores.some((store) => store.owned || store.permissions.includes("orders"));
  const aggregateMode = scope === "ALL_AUTHORIZED" && hasAnyAuthorizedStore;

  return <View style={styles.container}>
    <Text style={styles.sectionTitle}>الطلبات</Text>
    {aggregateMode ? null : <PartnerStoreScopeSelector requiredPermissions={["orders"]} />}
    <View style={styles.card}>
      <Text style={styles.metaLabel}>نطاق عرض الطلبات</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <BthwaniChip disabled={!hasAnyAuthorizedStore} label="المتجر المختار" onPress={() => setScope("SELECTED_STORE")} selected={!aggregateMode} />
        <BthwaniChip disabled={!hasAnyAuthorizedStore} label="كل المتاجر المصرح بها" onPress={() => setScope("ALL_AUTHORIZED")} selected={aggregateMode} />
      </View>
      <Text style={styles.muted}>يعيد الخادم الطلبات من المتاجر المصرح بها فقط، ويحسب العدّادات أعلى القائمة من نطاقك المصرح به كاملًا.</Text>
    </View>
    {state.kind === "ready" && !aggregateMode && selectedStore && !canManageOrders ? <View style={styles.card}><Text style={styles.muted}>المتجر المختار حاليًا لا يمنح هذا الحساب صلاحية إدارة الطلبات. اختر متجرًا آخر من القائمة أعلاه.</Text></View> : null}
    {aggregateMode ? <View style={styles.card}>
      <OrderManagement key="all-authorized" />
    </View> : null}
    {!aggregateMode && selectedStore && canManageOrders ? <View style={styles.card}>
      <Text style={styles.value}>{selectedStore.name}</Text>
      <OrderManagement key={selectedStore.id} storeId={selectedStore.id} />
    </View> : null}
  </View>;
}
