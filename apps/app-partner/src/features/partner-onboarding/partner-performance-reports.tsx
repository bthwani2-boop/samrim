import { typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { collectPartnerOrderReportCsv, collectStoreCatalogCsv, createDshMobileClient, formatMoney, orderStateLabel, PARTNER_ORDER_REPORT_PAGE_SIZE, STORE_CATALOG_EXPORT_PAGE_SIZE, type CatalogStoreOffer, type Order, type PartnerAccessibleStore, type PartnerStoreOrderSummary } from "@bthwani/dsh";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { isOfferStockout } from "../store-offer/inventory-stockout";
import { PartnerInventorySummary } from "./partner-inventory-summary";

export type PerformanceReportView = "orders" | "catalog";
const PAGE_SIZE = 25;

function dateLabel(iso: string): string {
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("ar-YE", { timeZone: "Asia/Aden", day: "numeric", month: "short", year: "numeric" }) : "—";
}
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function asCsv(rows: readonly (readonly string[])[]): string {
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}

export function PartnerPerformanceReport({ store, view }: { store: PartnerAccessibleStore; view: PerformanceReportView }) {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => StyleSheet.create({
    screen: { gap: 14 },
    heading: { ...typography.titleMd, color: theme.color, fontWeight: "800" },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    caption: { ...typography.caption, color: theme.colorMuted },
    toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 },
    panel: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 14, padding: 15, gap: 12 },
    cards: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    card: { flexGrow: 1, flexBasis: 140, minWidth: 125, backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12, padding: 13, gap: 8 },
    value: { ...typography.titleMd, color: theme.color, fontWeight: "800" },
    row: { borderTopWidth: 1, borderTopColor: theme.borderColor, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    rowMain: { flex: 1, minWidth: 0, gap: 4 },
    rowTitle: { ...typography.bodyStrong, color: theme.color, fontWeight: "700" },
    amount: { ...typography.bodySm, color: theme.color, fontWeight: "700", textAlign: "left" },
    button: { minHeight: 40, paddingHorizontal: 13, borderRadius: 10, backgroundColor: theme.actionSoft, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
    buttonText: { ...typography.bodySm, color: theme.interactiveText, fontWeight: "700" },
    disabled: { opacity: 0.4 },
    paging: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
    periodRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    activePeriod: { backgroundColor: theme.actionBackground },
    activePeriodText: { ...typography.bodySm, color: theme.onAction, fontWeight: "800" },
    warning: { ...typography.bodySm, color: theme.danger },
  }), [theme]);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([]);
  const [offers, setOffers] = useState<ReadonlyArray<CatalogStoreOffer>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const activeScope = useRef({ storeId: store.id, view });
  activeScope.current = { storeId: store.id, view };
  const [retry, setRetry] = useState(0);
  const [summaryPeriod, setSummaryPeriod] = useState<"7d" | "30d" | "all">("30d");
  const [orderSummary, setOrderSummary] = useState<PartnerStoreOrderSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const allowed = store.owned || store.permissions.includes(view === "orders" ? "orders" : "catalog");

  useFocusEffect(useCallback(() => {
    // An explicit retry re-fetches the same Store and page after a failed request.
    void retry;
    let active = true;
    setOrders([]); setOffers([]); setNextCursor(""); setError(""); setCopyStatus("");
    if (!allowed) { setLoading(false); return () => { active = false; }; }
    setLoading(true);
    const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!base) { setLoading(false); setError("عنوان خدمة البيانات غير متاح."); return () => { active = false; }; }
    const api = createDshMobileClient(base, { cryptoRandomUUID: () => Crypto.randomUUID() });
    const identity = currentIdentityState();
    const actorID = identity.kind === "authenticated" ? identity.identity.subject : "";
    const stillCurrent = () => {
      const latest = currentIdentityState();
      return active && !!actorID && latest.kind === "authenticated" && latest.identity.subject === actorID;
    };
    void (async () => {
      if (!actorID) throw new Error("PARTNER_SESSION_REQUIRED");
      const token = await getUsableIdentityAccessToken();
      if (view === "orders") {
        const response = await api.listPartnerOrders(token, { storeIds: [store.id], limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
        if (stillCurrent()) { setOrders(response.orders.filter(order => order.storeId === store.id)); setNextCursor(response.nextCursor ?? ""); }
      } else {
        const response = await api.readOwnStoreOffers(token, store.id, PAGE_SIZE, cursor);
        if (stillCurrent()) { setOffers(response.offers.filter(offer => offer.storeId === store.id)); setNextCursor(response.nextCursor ?? ""); }
      }
      if (stillCurrent()) setLoading(false);
    })().catch(() => { if (stillCurrent()) { setError("تعذر قراءة التقرير. تحقق من الاتصال والصلاحيات ثم أعد المحاولة."); setLoading(false); } });
    return () => { active = false; };
  }, [store.id, view, cursor, allowed, retry]));

  useFocusEffect(useCallback(() => {
    // Retry deliberately re-reads the same Store and selected period.
    void retry;
    let active = true;
    setOrderSummary(null); setSummaryError("");
    if (view !== "orders" || !allowed) { setSummaryLoading(false); return () => { active = false; }; }
    setSummaryLoading(true);
    const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!base) { setSummaryLoading(false); setSummaryError("تعذر الوصول إلى خدمة مؤشرات الطلبات."); return () => { active = false; }; }
    const api = createDshMobileClient(base, { cryptoRandomUUID: () => Crypto.randomUUID() });
    const identity = currentIdentityState();
    const actorID = identity.kind === "authenticated" ? identity.identity.subject : "";
    const stillCurrent = () => {
      const latest = currentIdentityState();
      return active && !!actorID && latest.kind === "authenticated" && latest.identity.subject === actorID;
    };
    if (!actorID) {
      setSummaryError("يلزم تسجيل الدخول لقراءة إجماليات المتجر.");
      setSummaryLoading(false);
      return () => { active = false; };
    }
    void (async () => {
      const token = await getUsableIdentityAccessToken();
      const response = await api.readPartnerStoreOrderSummary(token, store.id, summaryPeriod);
      if (!response.summary || response.summary.storeId !== store.id || response.summary.period !== summaryPeriod) {
        throw new Error("DSH_PARTNER_ORDER_SUMMARY_SCOPE_MISMATCH");
      }
      if (stillCurrent()) {
        setOrderSummary(response.summary);
        setSummaryLoading(false);
      }
    })().catch(() => { if (stillCurrent()) { setSummaryError("تعذر قراءة إجماليات المتجر؛ أعد المحاولة."); setSummaryLoading(false); } });
    return () => { active = false; };
  }, [store.id, view, allowed, summaryPeriod, retry]));

  const visibleCount = view === "orders" ? orders.length : offers.length;
  const summary = view === "orders" ? [
    { label: "طلبات الصفحة الحالية", value: String(orders.length) },
    { label: "تم تسليمها في هذه الصفحة", value: String(orders.filter(item => item.state === "DELIVERED").length) },
    { label: "إجمالي قيم هذه الصفحة", value: formatMoney(orders.reduce((sum, item) => sum + item.totalAmountMinor, 0), "YER") },
  ] : [
    { label: "منتجات الصفحة الحالية", value: String(offers.length) },
    { label: "منشورة ومتاحة في هذه الصفحة", value: String(offers.filter(item => item.publicationState === "published" && item.availability).length) },
    { label: "نفاد مؤكد في هذه الصفحة", value: String(offers.filter(isOfferStockout).length) },
  ];
  const exportRows: readonly (readonly string[])[] = view === "orders"
    ? [["رقم الطلب", "الحالة", "تاريخ الإنشاء", "الإجمالي"], ...orders.map(item => [item.id, orderStateLabel(item.state), dateLabel(item.createdAt), formatMoney(item.totalAmountMinor, "YER")])]
    : [["المنتج", "النوع", "حالة النشر", "التوفر", "السعر"], ...offers.map(item => [item.productName, item.variantTitle, item.publicationState === "published" ? "منشور" : item.publicationState === "draft" ? "مسودة" : "مخفي", item.availability ? "متاح" : "غير متاح", formatMoney(item.priceMinor, "YER")])];

  const copyReport = () => {
    void Clipboard.setStringAsync(asCsv(exportRows)).then(() => setCopyStatus("تم نسخ بيانات الصفحة الحالية بصيغة CSV."))
      .catch(() => setCopyStatus("تعذر نسخ البيانات، حاول مجددًا."));
  };
  async function downloadCompleteReport() {
    if (exportBusy || !allowed) return;
    const selected = currentIdentityState();
    const actorId = selected.kind === "authenticated" ? selected.identity.subject : "";
    const isCurrent = () => {
      const latest = currentIdentityState();
      return Boolean(actorId) && latest.kind === "authenticated" &&
        latest.identity.subject === actorId &&
        activeScope.current.storeId === store.id && activeScope.current.view === view;
    };
    setExportBusy(true);
    setExportError("");
    setExportStatus("");
    setExportProgress(0);
    try {
      if (!isCurrent()) throw new Error("REPORT_EXPORT_SESSION_CHANGED");
      const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if (!base) throw new Error("REPORT_EXPORT_SERVICE_MISSING");
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) throw new Error("REPORT_EXPORT_SESSION_CHANGED");
      const api = createDshMobileClient(base, { cryptoRandomUUID: () => Crypto.randomUUID() });
      const result = view === "orders"
        ? await collectPartnerOrderReportCsv(store.id, async pageCursor => {
          if (!isCurrent()) throw new Error("REPORT_EXPORT_SESSION_CHANGED");
          const page = await api.listPartnerOrders(token, {
            storeIds: [store.id], limit: PARTNER_ORDER_REPORT_PAGE_SIZE,
            ...(pageCursor ? { cursor: pageCursor } : {}),
          });
          if (!isCurrent()) throw new Error("REPORT_EXPORT_SESSION_CHANGED");
          return page;
        }, count => { if (isCurrent()) setExportProgress(count); })
        : await collectStoreCatalogCsv(store.id, async pageCursor => {
          if (!isCurrent()) throw new Error("REPORT_EXPORT_SESSION_CHANGED");
          const page = await api.readOwnStoreOffers(token, store.id, STORE_CATALOG_EXPORT_PAGE_SIZE, pageCursor);
          if (!isCurrent()) throw new Error("REPORT_EXPORT_SESSION_CHANGED");
          return page;
        }, count => { if (isCurrent()) setExportProgress(count); });
      if (!isCurrent()) throw new Error("REPORT_EXPORT_SESSION_CHANGED");
      if (!result.count) {
        setExportStatus("لا توجد سجلات في المتجر لتصديرها.");
        return;
      }
      const filename = `bthwani-store-${encodeURIComponent(store.id)}-${view}-report.csv`;
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          anchor.click();
        } finally { URL.revokeObjectURL(url); }
      } else {
        if (!await Sharing.isAvailableAsync()) throw new Error("REPORT_EXPORT_SHARING_UNAVAILABLE");
        if (!isCurrent()) throw new Error("REPORT_EXPORT_SESSION_CHANGED");
        const file = new File(Paths.cache, `bthwani-report-${Crypto.randomUUID()}.csv`);
        file.create();
        file.write(result.csv);
        await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "تصدير تقرير المتجر" });
      }
      if (isCurrent()) setExportStatus(`تم تجهيز ملف CSV يضم ${result.count} سجلًا من المتجر المصرح به.`);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      if (isCurrent()) setExportError(code === "ORDER_REPORT_TOO_LARGE_OR_INCONSISTENT" || code === "STORE_EXPORT_TOO_LARGE_OR_INCONSISTENT"
        ? "التقرير أكبر من الحد الآمن للجهاز أو تغيرت صفحاته؛ لم يُنشأ ملف ناقص."
        : code === "REPORT_EXPORT_SESSION_CHANGED" ? "تغير الحساب أو المتجر أثناء القراءة؛ أُلغي التصدير لحماية البيانات."
        : "تعذر تجهيز ملف CSV كامل. تحقق من الاتصال والصلاحيات ثم أعد المحاولة.");
    } finally {
      setExportBusy(false);
    }
  }

  return <View style={styles.screen}>
    <View style={styles.toolbar}>
      <View style={{ flex: 1, gap: 5, minWidth: 190 }}>
        <Text accessibilityRole="header" style={styles.heading}>{view === "orders" ? "تقرير الطلبات" : "تقرير المنتجات والمخزون"}</Text>
        <Text style={styles.muted}>{store.name} · بيانات فعلية حسب الصلاحية</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="نسخ تقرير الصفحة الحالية بصيغة CSV" disabled={loading || !!error || !allowed || visibleCount === 0}
        style={[styles.button, (loading || !!error || !allowed || visibleCount === 0) && styles.disabled]} onPress={copyReport}>
        <BthwaniIcon name="edit" size={17} color={theme.interactiveText}/><Text style={styles.buttonText}>نسخ CSV</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="تنزيل CSV لجميع صفحات المتجر" disabled={exportBusy || !allowed}
        style={[styles.button, (exportBusy || !allowed) && styles.disabled]} onPress={() => void downloadCompleteReport()}>
        <BthwaniIcon name="edit" size={17} color={theme.interactiveText}/>
        <Text style={styles.buttonText}>{exportBusy ? `جارٍ جمع ${exportProgress} سجلًا…` : "تنزيل CSV كامل"}</Text>
      </Pressable>
    </View>
    <Text style={styles.caption}>نسخ CSV يخص الصفحة المعروضة، أما تنزيل CSV الكامل فيجمع جميع صفحات المتجر ضمن حد حماية الجهاز. فترة مؤشرات الإجماليات لا تُقيّد ملف التصدير. قيم الطلبات تشغيلية لدى DSH وليست إيرادات أو تسويات WLT.</Text>
    {view === "catalog" && allowed ? <PartnerInventorySummary store={store} /> : null}
    {exportError ? <Text accessibilityRole="alert" style={styles.warning}>{exportError}</Text> : null}
    {exportStatus ? <Text accessibilityLiveRegion="polite" style={styles.caption}>{exportStatus}</Text> : null}
    {view === "orders" && allowed ? <View style={styles.panel} accessibilityLabel="الإجماليات التشغيلية للمتجر">
      <Text accessibilityRole="header" style={styles.heading}>إجماليات الطلبات من الخادم</Text>
      <View style={styles.periodRow}>
        {([{ id: "7d", label: "آخر 7 أيام" }, { id: "30d", label: "آخر 30 يومًا" }, { id: "all", label: "كل الفترات" }] as const).map(item =>
          <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: item.id === summaryPeriod }}
            onPress={() => setSummaryPeriod(item.id)} style={[styles.button, summaryPeriod === item.id && styles.activePeriod]}>
            <Text style={summaryPeriod === item.id ? styles.activePeriodText : styles.buttonText}>{item.label}</Text>
          </Pressable>)}
      </View>
      {summaryLoading ? <ActivityIndicator accessibilityLabel="جارٍ قراءة إجماليات الطلبات" color={theme.brandAction} /> : null}
      {summaryError ? <Pressable accessibilityRole="button" accessibilityLabel="إعادة قراءة إجماليات الطلبات" onPress={() => setRetry(current => current + 1)}>
        <Text style={styles.warning}>{summaryError}</Text>
      </Pressable> : null}
      {orderSummary && !summaryLoading && !summaryError ? <>
        <View style={styles.cards}>
          {[
            { label: "جميع طلبات الفترة", value: orderSummary.totalOrders.toLocaleString("ar-YE") },
            { label: "طلبات مكتملة", value: (orderSummary.deliveredOrders + orderSummary.pickedUpOrders).toLocaleString("ar-YE") },
            { label: "عملاء أكملوا طلبًا", value: orderSummary.completedCustomers.toLocaleString("ar-YE") },
            { label: "عملاء كرروا الشراء", value: orderSummary.returningCustomers.toLocaleString("ar-YE") },
            { label: "طلبات ملغاة أو مرفوضة", value: (orderSummary.cancelledOrders + orderSummary.rejectedOrders).toLocaleString("ar-YE") },
            { label: "قيمة الطلبات المكتملة المسجلة", value: formatMoney(orderSummary.completedOrderValueMinor, "YER") },
          ].map(item => <View key={item.label} style={styles.card}><Text style={styles.caption}>{item.label}</Text><Text style={styles.value}>{item.value}</Text></View>)}
        </View>
        <Text style={styles.caption}>مؤشرات العملاء تحسب المشترين الذين اكتملت طلباتهم خلال الفترة المختارة فقط؛ «كرروا الشراء» يعني طلبين مكتملين على الأقل للمتجر نفسه خلال هذه الفترة. لا تُعرض هويات العملاء. وقيمة الطلبات في DSH ليست رصيد WLT.</Text>
      </> : null}
    </View> : null}
    {!allowed ? <Text style={styles.warning}>لا تملك صلاحية قراءة هذا التقرير للمتجر المحدد.</Text> : null}
    {loading ? <View style={styles.panel}><ActivityIndicator color={theme.brandAction}/><Text style={styles.muted}>جارٍ قراءة التقرير...</Text></View> : null}
    {error ? <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={styles.panel}><Text style={styles.warning}>{error} · إعادة المحاولة</Text></Pressable> : null}
    {!loading && !error && allowed ? <>
      <View style={styles.cards}>{summary.map(item => <View key={item.label} style={styles.card}><Text style={styles.caption}>{item.label}</Text><Text style={styles.value}>{item.value}</Text></View>)}</View>
      <View style={styles.panel}>
        <Text style={styles.heading}>السجلات ({visibleCount.toLocaleString("ar-YE")})</Text>
        {!visibleCount ? <Text style={styles.muted}>لا توجد سجلات في هذه الصفحة.</Text> : null}
        {view === "orders" ? orders.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={"فتح الطلب " + item.id}
          onPress={() => router.navigate({ pathname: "/orders", params: { orderId: item.id } } as Href)} style={styles.row}>
          <View style={styles.rowMain}><Text style={styles.rowTitle} numberOfLines={1}>{"طلب #" + item.id.slice(-8)}</Text>
            <Text style={styles.caption}>{orderStateLabel(item.state)} · {dateLabel(item.createdAt)}</Text></View>
          <Text style={styles.amount}>{formatMoney(item.totalAmountMinor, "YER")}</Text>
        </Pressable>) : offers.map(item => <Pressable key={item.offerId} accessibilityRole="button" accessibilityLabel={"فتح المنتجات: " + item.productName}
          onPress={() => router.navigate("/products" as Href)} style={styles.row}>
          <View style={styles.rowMain}><Text style={styles.rowTitle} numberOfLines={1}>{item.productName}</Text>
            <Text style={styles.caption} numberOfLines={1}>{item.variantTitle} · {item.publicationState === "published" ? (item.availability ? "متاح" : "غير متاح") : "غير منشور"}{isOfferStockout(item) ? " · مخزون نافد" : ""}</Text></View>
          <Text style={styles.amount}>{formatMoney(item.priceMinor, "YER")}</Text>
        </Pressable>)}
      </View>
      <View style={styles.paging}>
        <Pressable accessibilityRole="button" accessibilityLabel="الصفحة السابقة" disabled={!history.length}
          style={[styles.button, !history.length && styles.disabled]} onPress={() => { setCursor(history[history.length - 1] ?? ""); setHistory(current => current.slice(0, -1)); }}>
          <Text style={styles.buttonText}>السابق</Text>
        </Pressable>
        <Text style={styles.caption}>الصفحة {(history.length + 1).toLocaleString("ar-YE")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="الصفحة التالية" disabled={!nextCursor}
          style={[styles.button, !nextCursor && styles.disabled]} onPress={() => { setHistory(current => [...current, cursor]); setCursor(nextCursor); }}>
          <Text style={styles.buttonText}>التالي</Text>
        </Pressable>
      </View>
      {copyStatus ? <Text accessibilityLiveRegion="polite" style={styles.caption}>{copyStatus}</Text> : null}
    </> : null}
  </View>;
}
