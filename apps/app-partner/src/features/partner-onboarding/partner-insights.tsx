import { typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type PartnerOrderAttentionCounts, type PartnerScopedFinanceStore } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { usePartnerStoreScope } from "./partner-store-scope-context";

type Snapshot = Readonly<{
  orders: PartnerOrderAttentionCounts | null;
  available: number | null;
  unavailable: number | null;
  truncated: boolean;
  promotions: number | null;
  finance: PartnerScopedFinanceStore | null;
}>;
const blank: Snapshot = { orders: null, available: null, unavailable: null, truncated: false, promotions: null, finance: null };

export function PartnerInsights() {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const { selectedStore } = usePartnerStoreScope();
  const styles = useMemo(() => StyleSheet.create({
    screen: { gap: 10, paddingTop: 9 },
    metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    metric: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12, padding: 12, width: "48.4%", gap: 3, minHeight: 90 },
    value: { ...typography.titleMd, fontWeight: "800", color: theme.color },
    label: { ...typography.caption, color: theme.colorMuted },
    note: { ...typography.caption, color: theme.colorMuted },
    panel: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
    heading: { ...typography.bodyStrong, color: theme.color },
    body: { ...typography.bodySm, color: theme.colorMuted },
    actionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    actionChip: { borderWidth: 1, borderColor: theme.borderColor, borderRadius: 9, minHeight: 35, paddingHorizontal: 13, justifyContent: "center" },
    actionLabel: { ...typography.caption, color: theme.brandAction, fontWeight: "700" },
  }), [theme]);
  const [snapshot, setSnapshot] = useState<Snapshot>(blank);
  const [loading, setLoading] = useState(true);
  useFocusEffect(useCallback(() => {
    let active = true;
    setSnapshot(blank);
    setLoading(true);
    const store = selectedStore;
    if (!store) { setLoading(false); return; }
    const catalog = store.owned || store.permissions.includes("catalog");
    const orders = store.owned || store.permissions.includes("orders");
    const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!base) { setLoading(false); return; }
    const api = createDshMobileClient(base, { cryptoRandomUUID: () => Crypto.randomUUID() });
    const read = async () => {
      const token = await getUsableIdentityAccessToken();
      const [orderResult, productResult, promotionResult, financeResult] = await Promise.allSettled([
        orders ? api.listPartnerOrders(token, { storeIds: [store.id], limit: 1 }) : Promise.resolve(null),
        catalog ? api.readOwnStoreOffers(token, store.id, 100) : Promise.resolve(null),
        api.listPublicPromotions(store.serviceCityId, store.id),
        store.owned ? api.readOwnPartnerFinancialSummary(token) : Promise.resolve(null),
      ]);
      if (!active) return;
      const o = orderResult.status === "fulfilled" ? orderResult.value : null;
      const p = productResult.status === "fulfilled" ? productResult.value : null;
      const promo = promotionResult.status === "fulfilled" ? promotionResult.value : null;
      const financial = financeResult.status === "fulfilled" ? financeResult.value : null;
      setSnapshot({
        orders: o?.attention ?? null,
        available: p ? p.offers.filter((offer) => offer.publicationState === "published" && offer.availability).length : null,
        unavailable: p ? p.offers.filter((offer) => offer.publicationState === "published" && !offer.availability).length : null,
        truncated: Boolean(p?.nextCursor),
        promotions: promo?.promotions.length ?? null,
        finance: financial?.summary.stores.find((item) => item.storeId === store.id) ?? null,
      });
      setLoading(false);
    };
    void read().catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedStore]));
  const metric = (label: string, value: string) => <View style={styles.metric} key={label}><Text style={styles.value}>{value}</Text><Text style={styles.label}>{label}</Text></View>;
  return <View style={styles.screen}>
    {loading ? <Text style={styles.note}>جارٍ قراءة المؤشرات...</Text> : null}
    <View style={styles.metrics}>
      {selectedStore && (selectedStore.owned || selectedStore.permissions.includes("orders")) ? metric("طلبات تحتاج قبولًا", snapshot.orders?.newOrders.toLocaleString("ar-YE") ?? "—") : null}
      {selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")) ? metric("منتجات متاحة", snapshot.available?.toLocaleString("ar-YE") ?? "—") : null}
      {selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")) ? metric("منتجات غير متاحة", snapshot.unavailable?.toLocaleString("ar-YE") ?? "—") : null}
      {selectedStore ? metric("عروض منشورة", snapshot.promotions?.toLocaleString("ar-YE") ?? "—") : null}
      {snapshot.finance && snapshot.finance.attributionComplete ? metric("مستحقات مكتسبة", formatMoney(snapshot.finance.earnedMinor, "YER")) : null}
      {snapshot.finance && snapshot.finance.attributionComplete ? metric("طلبات محتسبة ماليًا", snapshot.finance.orderCount.toLocaleString("ar-YE")) : null}
    </View>
    {snapshot.truncated ? <Text style={styles.note}>مؤشرات المنتجات ضمن أول 100 منتج. توجد منتجات إضافية.</Text> : null}
    {snapshot.finance && !snapshot.finance.attributionComplete ? <Text style={styles.note}>البيانات المالية غير مكتملة؛ لم تُعرض أرقام تقديرية.</Text> : null}
    <View style={styles.panel}>
      <Text style={styles.heading}>فرص لتحسين المبيعات</Text>
      {snapshot.unavailable !== null && snapshot.unavailable > 0 ? <Text style={styles.body}>توجد منتجات منشورة غير متاحة. راجع مخزونها حتى لا تضيع طلبات محتملة.</Text> : null}
      {snapshot.promotions === 0 ? <Text style={styles.body}>لا توجد عروض منشورة. راجع العروض المتاحة قبل إنشاء حملة جديدة.</Text> : null}
      {snapshot.orders !== null && snapshot.orders.newOrders > 0 ? <Text style={styles.body}>توجد طلبات جديدة تحتاج قبولًا.</Text> : null}
      {snapshot.unavailable === 0 && snapshot.promotions !== 0 && (!snapshot.orders || snapshot.orders.newOrders === 0) ? <Text style={styles.body}>لا توجد إجراءات معلقة من المؤشرات المتاحة.</Text> : null}
      <View style={styles.actionRow}>
        <Pressable accessibilityRole="button" onPress={() => router.navigate("/products" as Href)} style={styles.actionChip}><Text style={styles.actionLabel}>المنتجات</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.navigate("/orders" as Href)} style={styles.actionChip}><Text style={styles.actionLabel}>الطلبات</Text></Pressable>
      </View>
    </View>
    <Text style={styles.note}>المؤشرات المعروضة من بيانات المتجر الفعلية في DSH، وليست توقعات أو معدل نمو.</Text>
  </View>;
}
