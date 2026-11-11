import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { currentIdentityState } from "../../bootstrap/identity";
import { canUseStoreOrders, isMarketplaceStore } from "../../shell/partner-authority";
import { OrderManagement } from "../order-management/order-management";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

type OrdersScope = "SELECTED_STORE" | "ALL_AUTHORIZED";

export function PartnerOrders() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state, stores, selectedStore, selectStore } = usePartnerStoreScope();
  const { storeId: rawTargetStore, scope: rawScope } = useLocalSearchParams<{storeId?: string | string[]; scope?: string | string[]}>();
  const targetStoreId = Array.isArray(rawTargetStore) ? rawTargetStore[0] : rawTargetStore;
  const routeScope = Array.isArray(rawScope) ? rawScope[0] : rawScope;
  const identityScope = partnerSetupSessionKey(currentIdentityState());
  const [scope, setScope] = useState<OrdersScope>(routeScope === "all" ? "ALL_AUTHORIZED" : "SELECTED_STORE");
  useEffect(() => { setScope(routeScope === "all" ? "ALL_AUTHORIZED" : "SELECTED_STORE"); }, [routeScope]);
  const permittedStores = stores.filter(canUseStoreOrders);
  const canManageOrders = Boolean(selectedStore && canUseStoreOrders(selectedStore));
  const marketOrderStoreIDs = useMemo(() => stores.filter(store => isMarketplaceStore(store) && canUseStoreOrders(store))
    .map(store => store.id).sort((left, right) => left.localeCompare(right)), [stores]);
  const marketAggregateTooLarge = marketOrderStoreIDs.length > 200;
  const showMarketAggregate = !targetStoreId && Boolean(selectedStore && isMarketplaceStore(selectedStore)) &&
    marketOrderStoreIDs.length > 1 && !marketAggregateTooLarge;
  const aggregateMode = scope === "ALL_AUTHORIZED" && showMarketAggregate;
  const targetStorePermitted = permittedStores.some(store => store.id === targetStoreId);
  const appliedTargetStore = useRef({ session: "", storeId: "", observed: false });
  const targetAlreadyApplied = appliedTargetStore.current.session === identityScope &&
    appliedTargetStore.current.storeId === targetStoreId;
  const targetWasShown = targetAlreadyApplied && appliedTargetStore.current.observed;
  const deniedTarget = state.kind === "ready" && Boolean(targetStoreId) && !targetStorePermitted;
  const targetSwitchPending = state.kind === "ready" && Boolean(targetStoreId) &&
    targetStorePermitted && selectedStore?.id !== targetStoreId && !targetWasShown;
  const canRenderOrders = state.kind === "ready" && !deniedTarget && !targetSwitchPending;

  // Apply an authorized URL target once per Identity session. A manual Store
  // choice must remain possible, but a different actor cannot inherit this ref.
  useEffect(() => {
    if (!targetStoreId) {
      appliedTargetStore.current = { session: identityScope, storeId: "", observed: false };
      return;
    }
    if (state.kind !== "ready" || !targetStorePermitted) return;
    if (targetAlreadyApplied) {
      if (selectedStore?.id === targetStoreId) appliedTargetStore.current.observed = true;
      return;
    }
    appliedTargetStore.current = { session: identityScope, storeId: targetStoreId, observed: selectedStore?.id === targetStoreId };
    if (selectedStore?.id !== targetStoreId) selectStore(targetStoreId);
  }, [identityScope, state.kind, targetStoreId, selectedStore?.id, targetStorePermitted, targetAlreadyApplied, selectStore]);

  return <View style={styles.container}>
    {state.kind !== "ready" ? <PartnerStoreScopeSelector eligible={canUseStoreOrders} /> : null}
    {deniedTarget ? <View style={styles.card}>
      <Text accessibilityRole="alert" style={styles.error}>لا توجد صلاحية لطلبات هذا المتجر.</Text>
      <BthwaniButton label="العودة إلى طلبات متاجرك" variant="secondary" onPress={() => router.replace("/orders" as Href)} />
    </View> : null}
    {targetSwitchPending ? <View style={styles.card}>
      <Text style={styles.muted}>جارٍ فتح طلبات المتجر المحدد…</Text>
    </View> : null}
    {canRenderOrders && marketAggregateTooLarge && selectedStore && isMarketplaceStore(selectedStore) ?
      <View style={styles.card}><Text style={styles.muted}>عرض جميع طلبات متاجر السوق معًا غير متاح لأكثر من 200 متجر. اختر المتجر المطلوب لعرض طلباته.</Text></View> : null}
    {canRenderOrders && showMarketAggregate ? <View style={styles.choiceRow} accessibilityLabel="نطاق الطلبات">
      <BthwaniChip label="المتجر المختار" onPress={() => setScope("SELECTED_STORE")} selected={!aggregateMode} />
      <BthwaniChip label="جميع متاجر السوق" onPress={() => setScope("ALL_AUTHORIZED")} selected={aggregateMode} />
    </View> : null}
    {canRenderOrders && !aggregateMode && (permittedStores.length > 1 || !canManageOrders) ? <PartnerStoreScopeSelector eligible={canUseStoreOrders} /> : null}
    {canRenderOrders && !aggregateMode && selectedStore && canManageOrders && !isMarketplaceStore(selectedStore) ?
      <View style={styles.card}><Text accessibilityRole="text" style={styles.muted}>استقبال الطلبات المباشرة غير مفعّل حاليًا. يمكنك مراجعة سجل الطلبات لهذا المتجر.</Text></View> : null}
    {canRenderOrders && !aggregateMode && selectedStore && canManageOrders ? <OrderManagement key={`orders:${identityScope}:${selectedStore.id}`} storeId={selectedStore.id} /> : null}
    {canRenderOrders && aggregateMode ? <OrderManagement key={`all-marketplace:${identityScope}:${marketOrderStoreIDs.join(",")}`} storeIds={marketOrderStoreIDs} /> : null}
    {canRenderOrders && permittedStores.length === 0 ? <View style={styles.card}><Text style={styles.muted}>لا توجد متاجر مخوّل لك استقبال طلباتها.</Text></View> : null}
  </View>;
}
