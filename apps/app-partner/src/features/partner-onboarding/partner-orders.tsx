import { BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
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
  const [scope, setScope] = useState<OrdersScope>("SELECTED_STORE");
  const permittedStores = stores.filter((store) => store.owned || store.permissions.includes("orders"));
  const canManageOrders = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("orders")));
  const aggregateMode = scope === "ALL_AUTHORIZED" && permittedStores.length > 1;

  useEffect(() => {
    if (state.kind !== "ready" || canManageOrders) return;
    const next = permittedStores[0];
    if (next && next.id !== selectedStore?.id) selectStore(next.id);
  }, [state.kind, canManageOrders, permittedStores, selectedStore?.id, selectStore]);

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
    {state.kind === "ready" && !permittedStores.length ? <View style={styles.card}><Text style={styles.muted}>لا توجد متاجر مخوّل لك استقبال طلباتها.</Text></View> : null}
  </View>;
}
