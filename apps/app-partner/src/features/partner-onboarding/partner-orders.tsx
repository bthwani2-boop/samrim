import { BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { OrderManagement } from "../order-management/order-management";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { canUseStoreOrders, isMarketplaceStore } from "../../shell/partner-authority";

type OrdersScope = "SELECTED_STORE" | "ALL_AUTHORIZED";

export function PartnerOrders() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state, stores, selectedStore, selectStore } = usePartnerStoreScope();
  const { storeId: rawTargetStore, scope: rawScope } = useLocalSearchParams<{storeId?: string | string[]; scope?: string | string[]}>();
  const targetStoreId = Array.isArray(rawTargetStore) ? rawTargetStore[0] : rawTargetStore;
  const routeScope = Array.isArray(rawScope) ? rawScope[0] : rawScope;
  const [scope, setScope] = useState<OrdersScope>(routeScope === "all" ? "ALL_AUTHORIZED" : "SELECTED_STORE");
  useEffect(() => { setScope(routeScope === "all" ? "ALL_AUTHORIZED" : "SELECTED_STORE"); }, [routeScope]);
  const permittedStores = stores.filter(canUseStoreOrders);
  const canManageOrders = Boolean(selectedStore && canUseStoreOrders(selectedStore));
  const marketOrderStoreIDs = useMemo(() => stores.filter(store => isMarketplaceStore(store) && canUseStoreOrders(store))
    .map(store => store.id).sort(), [stores]);
  const marketAggregateTooLarge = marketOrderStoreIDs.length > 200;
  const showMarketAggregate = Boolean(selectedStore && isMarketplaceStore(selectedStore)) &&
    marketOrderStoreIDs.length > 1 && !marketAggregateTooLarge;
  const aggregateMode = scope === "ALL_AUTHORIZED" && showMarketAggregate;
  const targetStorePermitted = permittedStores.some(store => store.id === targetStoreId);
  const appliedTargetStore = useRef("");

  // Resolve an authorized deep-link target once for each URL value. Reapplying
  // it after a manual Store selection would trap the Merchant on that Store.
  useEffect(() => {
    if (!targetStoreId) {
      appliedTargetStore.current = "";
      return;
    }
    if (state.kind !== "ready" || !targetStorePermitted || appliedTargetStore.current === targetStoreId) return;
    appliedTargetStore.current = targetStoreId;
    if (selectedStore?.id !== targetStoreId) selectStore(targetStoreId);
  }, [state.kind, targetStoreId, selectedStore?.id, targetStorePermitted, selectStore]);

  return <View style={styles.container}>
    {marketAggregateTooLarge && selectedStore && isMarketplaceStore(selectedStore) ?
      <View style={styles.card}><Text style={styles.muted}>عرض جميع طلبات متاجر السوق معًا غير متاح لأكثر من 200 متجر. اختر المتجر المطلوب لعرض طلباته.</Text></View> : null}
    {showMarketAggregate ? <View style={styles.choiceRow} accessibilityLabel="نطاق الطلبات">
      <BthwaniChip label="المتجر المختار" onPress={() => setScope("SELECTED_STORE")} selected={!aggregateMode} />
      <BthwaniChip label="جميع متاجر السوق" onPress={() => setScope("ALL_AUTHORIZED")} selected={aggregateMode} />
    </View> : null}
    {!aggregateMode && (permittedStores.length > 1 || !canManageOrders) ? <PartnerStoreScopeSelector eligible={canUseStoreOrders} /> : null}
    {!aggregateMode && selectedStore && canManageOrders && !isMarketplaceStore(selectedStore) ?
      <View style={styles.card}><Text accessibilityRole="text" style={styles.muted}>استقبال الطلبات المباشرة غير مفعّل حاليًا. يمكنك مراجعة سجل الطلبات لهذا المتجر.</Text></View> : null}
    {!aggregateMode && selectedStore && canManageOrders ? <OrderManagement key={"orders:" + selectedStore.id} storeId={selectedStore.id} /> : null}
    {aggregateMode ? <OrderManagement key="all-marketplace" storeIds={marketOrderStoreIDs} /> : null}
    {state.kind === "ready" && targetStoreId && !permittedStores.some(store => store.id === targetStoreId) ? <View style={styles.card}><Text style={styles.muted}>لا توجد صلاحية لطلبات هذا المتجر.</Text></View> : null}
    {state.kind === "ready" && !permittedStores.length ? <View style={styles.card}><Text style={styles.muted}>لا توجد متاجر مخوّل لك استقبال طلباتها.</Text></View> : null}
  </View>;
}
