import { BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { OrderManagement } from "../order-management/order-management";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";

type OrdersScope = "SELECTED_STORE" | "ALL_AUTHORIZED";

export function PartnerOrders() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state, stores, selectedStore, selectStore } = usePartnerStoreScope();
  const { storeId: rawTargetStore } = useLocalSearchParams<{storeId?: string | string[]}>();
  const targetStoreId = Array.isArray(rawTargetStore) ? rawTargetStore[0] : rawTargetStore;
  const [scope, setScope] = useState<OrdersScope>("SELECTED_STORE");
  const permittedStores = stores.filter((store) => store.owned || store.permissions.includes("orders"));
  const canManageOrders = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("orders")));
  const aggregateMode = scope === "ALL_AUTHORIZED" && permittedStores.length > 1;
  const targetStorePermitted = permittedStores.some(store => store.id === targetStoreId);

  // Never change the store implicitly. Only a contextual order deep link can
  // select the explicitly named store, after confirming order permission.
  useEffect(() => {
    if (state.kind !== "ready" || !targetStoreId || selectedStore?.id === targetStoreId) return;
    if (targetStorePermitted) selectStore(targetStoreId);
  }, [state.kind, targetStoreId, selectedStore?.id, targetStorePermitted, selectStore]);

  return <View style={styles.container}>
    {permittedStores.length > 1 ? <View style={styles.choiceRow} accessibilityLabel="نطاق الطلبات">
      <BthwaniChip label="المتجر المختار" onPress={() => setScope("SELECTED_STORE")} selected={!aggregateMode} />
      <BthwaniChip label="جميع المتاجر" onPress={() => setScope("ALL_AUTHORIZED")} selected={aggregateMode} />
    </View> : null}
    {!aggregateMode && (permittedStores.length > 1 || !canManageOrders) ? <PartnerStoreScopeSelector requiredPermissions={["orders"]} /> : null}
    {!aggregateMode && selectedStore && canManageOrders ? <>
      <OrderManagement key={"orders:" + selectedStore.id} storeId={selectedStore.id} />
    </> : null}
    {aggregateMode ? <OrderManagement key="all-authorized" /> : null}
    {state.kind === "ready" && targetStoreId && !permittedStores.some(store => store.id === targetStoreId) ? <View style={styles.card}><Text style={styles.muted}>لا توجد صلاحية لطلبات هذا المتجر.</Text></View> : null}
    {state.kind === "ready" && !permittedStores.length ? <View style={styles.card}><Text style={styles.muted}>لا توجد متاجر مخوّل لك استقبال طلباتها.</Text></View> : null}
  </View>;
}
