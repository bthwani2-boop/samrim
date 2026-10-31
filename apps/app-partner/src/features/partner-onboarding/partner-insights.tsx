import { typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type PartnerOrderAttentionCounts, type PartnerScopedFinanceStore } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { isOfferStockout } from "../store-offer/inventory-stockout";
import { PartnerPerformanceReport } from "./partner-performance-reports";

type Snapshot = Readonly<{
  orders: PartnerOrderAttentionCounts | null;
  available: number | null;
  unavailable: number | null;
  stockout: number | null;
  truncated: boolean;
  promotions: number | null;
  finance: PartnerScopedFinanceStore | null;
}>;
const blank: Snapshot = { orders: null, available: null, unavailable: null, stockout: null, truncated: false, promotions: null, finance: null };

export function PartnerInsights({ embedded = false }: Readonly<{ embedded?: boolean }> = {}) {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const reportView = !embedded && (view === "orders" || view === "catalog") ? view : "overview";
  const { width } = useWindowDimensions();
  const desktopWeb = Platform.OS === "web" && width >= 1024;
  const { selectedStore } = usePartnerStoreScope();
  const canOrders = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("orders")));
  const canCatalog = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")));
  const styles = useMemo(() => StyleSheet.create({
    screen: { gap: desktopWeb ? 16 : 10, paddingTop: embedded ? 0 : 9 },
    metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    metric: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 14, padding: desktopWeb ? 17 : 12, width: desktopWeb ? "24%" : "48%", gap: 9, minHeight: desktopWeb ? 132 : 90, justifyContent: "space-between" },
    metricHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    metricIcon: { backgroundColor: theme.actionSoft, height: 34, width: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    value: { ...typography.titleLg, fontWeight: "800", color: theme.color },
    label: { ...typography.caption, color: theme.colorMuted, flexShrink: 1 },
    metricHint: { ...typography.caption, color: theme.colorMuted },
    note: { ...typography.caption, color: theme.colorMuted },
    panel: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 14, padding: desktopWeb ? 18 : 12, gap: 10 },
    heading: { ...typography.bodyStrong, color: theme.color, fontWeight: "800" },
    body: { ...typography.bodySm, color: theme.colorMuted },
    actionRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    actionChip: { borderWidth: 1, borderColor: theme.borderColor, borderRadius: 9, minHeight: 35, paddingHorizontal: 13, justifyContent: "center" },
    actionLabel: { ...typography.caption, color: theme.brandAction, fontWeight: "700" },
    desktopBoard: { flexDirection: "row", alignItems: "stretch", gap: 14 },
    desktopMain: { flex: 1, minWidth: 0, gap: 12 },
    desktopAside: { width: 252, minWidth: 0, gap: 12 },
    taskItem: { paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 10, borderBottomColor: theme.borderColor, borderBottomWidth: 1 },
    taskTitle: { ...typography.bodySm, color: theme.color, flex: 1, fontWeight: "700" },
    taskAction: { ...typography.caption, color: theme.brandAction, fontWeight: "800" },
    noticeItem: { backgroundColor: theme.surfaceInset, padding: 11, gap: 5, borderRadius: 10 },
    noticeTitle: { ...typography.bodySm, color: theme.color, fontWeight: "700" },
    noticeText: { ...typography.caption, color: theme.colorMuted },
  }), [theme, desktopWeb, embedded]);
  const [snapshot, setSnapshot] = useState<Snapshot>(blank);
  const [loading, setLoading] = useState(true);
  useFocusEffect(useCallback(() => {
    let active = true;
    setSnapshot(blank);
    setLoading(true);
    if (!embedded && reportView !== "overview") { setLoading(false); return () => { active = false; }; }
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
        stockout: p ? p.offers.filter(isOfferStockout).length : null,
        truncated: Boolean(p?.nextCursor),
        promotions: promo?.promotions.length ?? null,
        finance: financial?.summary.stores.find((item) => item.storeId === store.id) ?? null,
      });
      setLoading(false);
    };
    void read().catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedStore, embedded, reportView]));
  const metric = (label: string, value: string, icon: "orders" | "cart" | "wallet" | "store", href?: Href) =>
    <Pressable key={label} disabled={!href} accessibilityRole={href ? "button" : undefined} accessibilityLabel={href ? label + "، عرض التفاصيل" : undefined}
      onPress={() => { if (href) router.navigate(href); }} style={styles.metric}>
      <View style={styles.metricHead}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.metricIcon}><BthwaniIcon name={icon} color={theme.brandAction} size={19} /></View>
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.metricHint}>{href ? "عرض التفاصيل" : "حسب البيانات المتاحة"}</Text>
    </Pressable>;
  const notices = [
    ...(snapshot.orders?.newOrders ? [{ label: snapshot.orders.newOrders + " طلبات جديدة", hint: "تحتاج مراجعة وقبولًا", href: "/orders" as Href }] : []),
    ...(snapshot.orders?.deliveryRecovery ? [{ label: snapshot.orders.deliveryRecovery + " حالات تسليم متعثرة", hint: "تحتاج متابعة", href: "/orders" as Href }] : []),
    ...(snapshot.stockout ? [{ label: snapshot.stockout + " منتجات نفد مخزونها", hint: "مخزون معروف من المنتجات المنشورة المحمّلة", href: "/products?filter=stockout" as Href }] : []),
    ...(snapshot.unavailable ? [{ label: snapshot.unavailable + " منتجات غير متاحة", hint: "ضمن المنتجات المنشورة المحمّلة", href: "/products?filter=unavailable" as Href }] : []),
  ];
  const hasData = snapshot.orders !== null || snapshot.available !== null || snapshot.promotions !== null || snapshot.finance !== null;
  const missingData = (canOrders && snapshot.orders === null) || (canCatalog && snapshot.available === null);
  const action = (label: string, hint: string, href: Href) =>
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} style={styles.taskItem} onPress={() => String(href).startsWith("/store") ? router.push(href) : router.navigate(href)}>
      <Text style={styles.taskTitle}>{label}</Text><Text style={styles.taskAction}>{hint}</Text>
    </Pressable>;

  const reportTabs = () => <View style={styles.actionRow} accessibilityLabel="أقسام الأداء والتقارير">
    {([{ id: "overview", label: "نظرة عامة" }, ...(canOrders ? [{ id: "orders", label: "تقرير الطلبات" }] : []), ...(canCatalog ? [{ id: "catalog", label: "تقرير المنتجات" }] : [])] as const).map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label}
      accessibilityState={{ selected: reportView === item.id }} onPress={() => router.setParams({ view: item.id })}
      style={[styles.actionChip, reportView === item.id && { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground }]}>
      <Text style={styles.actionLabel}>{item.label}</Text>
    </Pressable>)}
    {selectedStore && (selectedStore.owned || selectedStore.permissions.includes("finance_read")) ? <Pressable accessibilityRole="button" accessibilityLabel="فتح التقرير المالي" onPress={() => router.navigate("/wallet" as Href)} style={styles.actionChip}><Text style={styles.actionLabel}>التقرير المالي</Text></Pressable> : null}
  </View>;

  if (!embedded && reportView !== "overview" && selectedStore) return <View style={styles.screen}>
    {reportTabs()}
    <PartnerPerformanceReport key={selectedStore.id + reportView} store={selectedStore} view={reportView}/>
  </View>;

  return <View style={styles.screen}>
    {!embedded ? reportTabs() : null}
    {loading ? <Text style={styles.note}>جارٍ تحديث مؤشرات المتجر...</Text> : null}
    <View style={styles.metrics}>
      {canOrders ? metric("طلبات جديدة", snapshot.orders?.newOrders.toLocaleString("ar-YE") ?? "—", "orders", "/orders" as Href) : null}
      {canOrders ? metric("بانتظار التسليم", snapshot.orders?.awaitingDispatch.toLocaleString("ar-YE") ?? "—", "store", "/orders" as Href) : null}
      {canCatalog ? metric("منتجات متاحة", snapshot.available?.toLocaleString("ar-YE") ?? "—", "cart", "/products" as Href) : null}
      {canCatalog && (snapshot.stockout ?? 0) > 0 ? metric("نفاد المخزون", snapshot.stockout?.toLocaleString("ar-YE") ?? "—", "cart", "/products?filter=stockout" as Href) : null}
      {snapshot.finance?.attributionComplete ? metric("مستحقات مكتسبة", formatMoney(snapshot.finance.earnedMinor, "YER"), "wallet", "/wallet" as Href) : null}
      {!embedded && canOrders ? metric("تسليم متعثر", snapshot.orders?.deliveryRecovery.toLocaleString("ar-YE") ?? "—", "orders", "/orders" as Href) : null}
      {!embedded && canCatalog ? metric("منتجات غير متاحة", snapshot.unavailable?.toLocaleString("ar-YE") ?? "—", "cart", "/products?filter=unavailable" as Href) : null}
      {!embedded && selectedStore ? metric("عروض منشورة", snapshot.promotions?.toLocaleString("ar-YE") ?? "—", "store") : null}
    </View>

    {embedded && desktopWeb ? <View style={styles.desktopBoard}>
      <View style={styles.desktopMain}>
        <View style={styles.panel}>
          <Text style={styles.heading}>مساحة العمل اليومي</Text>
          <Text style={styles.body}>الإجراءات الأساسية متاحة مباشرة وفق صلاحيتك في المتجر.</Text>
          {canOrders ? action("إدارة الطلبات", "فتح الطابور", "/orders" as Href) : null}
          {canCatalog ? action("تحديث المنتجات والأسعار", "فتح الكتالوج", "/products" as Href) : null}
          {selectedStore && (selectedStore.owned || selectedStore.permissions.includes("promotions")) ? action("مراجعة العروض", "إدارة العروض", "/store?section=promotions" as Href) : null}
          {!canOrders && !canCatalog ? <Text style={styles.body}>لا توجد مهام تشغيلية مسندة إلى هذا الحساب حاليًا.</Text> : null}
        </View>
      </View>
      <View style={styles.desktopAside}>
        <View style={styles.panel}>
          <Text style={styles.heading}>يحتاج انتباهك</Text>
          {notices.map(item => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label}
            onPress={() => router.navigate(item.href)} style={styles.noticeItem}>
            <Text style={styles.noticeTitle}>{item.label}</Text><Text style={styles.noticeText}>{item.hint}</Text>
          </Pressable>)}
          {!loading && !hasData ? <Text style={styles.body}>تعذر قراءة مؤشرات المتجر. راجع الاتصال أو الصلاحيات ثم أعد فتح اللوحة.</Text> : null}
          {!loading && hasData && missingData ? <Text style={styles.body}>بعض بيانات الطلبات أو المنتجات لم تُقرأ؛ لا يمكن اعتبار المتجر خاليًا من التنبيهات.</Text> : null}
          {!loading && hasData && !missingData && notices.length === 0 ? <Text style={styles.body}>لا توجد تنبيهات في المؤشرات التي أمكن قراءتها.</Text> : null}
          {loading ? <Text style={styles.body}>جارٍ فحص الطلبات والكتالوج...</Text> : null}
        </View>
      </View>
    </View> : <View style={styles.panel}>
      <Text style={styles.heading}>ما يستحق المتابعة</Text>
      {notices.map(item => <Text key={item.label} style={styles.body}>{item.label} — {item.hint}</Text>)}
      {!loading && !hasData ? <Text style={styles.body}>تعذر عرض مؤشرات المتجر حاليًا. راجع الاتصال أو الصلاحيات وأعد فتح الصفحة.</Text> : null}
      {!loading && hasData && missingData ? <Text style={styles.body}>تعذر قراءة بعض المؤشرات؛ حاول إعادة فتح الصفحة بعد التحقق من الاتصال.</Text> : null}
      {!loading && hasData && !missingData && notices.length === 0 ? <Text style={styles.body}>لا توجد تنبيهات في المؤشرات المتاحة.</Text> : null}
      {!embedded ? <View style={styles.actionRow}>
        {canCatalog ? <Pressable accessibilityRole="button" onPress={() => router.navigate("/products" as Href)} style={styles.actionChip}><Text style={styles.actionLabel}>المنتجات</Text></Pressable> : null}
        {canOrders ? <Pressable accessibilityRole="button" onPress={() => router.navigate("/orders" as Href)} style={styles.actionChip}><Text style={styles.actionLabel}>الطلبات</Text></Pressable> : null}
      </View> : null}
    </View>}
    {snapshot.truncated ? <Text style={styles.note}>مؤشرات المنتجات تخص أول 100 منتج فقط؛ توجد منتجات أخرى.</Text> : null}
    {snapshot.finance && !snapshot.finance.attributionComplete ? <Text style={styles.note}>البيانات المالية غير مكتملة، لذلك لم تُعرض مستحقات تقديرية.</Text> : null}
    <Text style={styles.note}>المؤشرات من بيانات بثواني الفعلية؛ ليست توقعًا للمبيعات ولا إحصاءً شاملًا إذا كانت النتائج مقسمة على صفحات.</Text>
  </View>;
}
