import { type resolveTheme, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type PartnerFinancialActivity as PartnerFinancialActivityRecord, type PartnerFinancialActivityFilters, type PartnerScopedFinancialSummary } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

const pageSize = 25;
type Period = "all" | "today" | "week" | "month";
type Selection = { storeId: string; kind: string; status: string; paymentMethod: string; period: Period };
const initial: Selection = { storeId: "", kind: "", status: "", paymentMethod: "", period: "month" };
const kinds = [{ id: "", label: "الكل" }, { id: "ORDER", label: "مستحقات الطلبات" }, { id: "CASH_COMMISSION", label: "ذمم العمولات" }, { id: "PAYOUT", label: "طلبات الصرف" }];
const statuses = [{ id: "", label: "كل الحالات" }, { id: "POSTED", label: "مثبت" }, { id: "PENDING", label: "قيد الصرف" }, { id: "COMPLETED", label: "مصروف" }, { id: "EXCEPTION", label: "يحتاج مراجعة" }, { id: "CANCELLED", label: "ملغى" }];
const payments = [{ id: "", label: "كل طرق الدفع" }, { id: "CASH_ON_DELIVERY", label: "نقدي عند التسليم" }, { id: "CASH_AT_STORE", label: "نقدي للمتجر" }, { id: "WALLET", label: "محفظة" }, { id: "MIXED", label: "مختلط" }];
const periods: { id: Period; label: string }[] = [{ id: "today", label: "اليوم" }, { id: "week", label: "7 أيام" }, { id: "month", label: "هذا الشهر" }, { id: "all", label: "كل الفترات" }];

function adenDate(value: Date): string {
  return new Date(value.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function range(period: Period): Pick<PartnerFinancialActivityFilters, "from" | "to"> {
  if (period === "all") return {};
  const now = new Date();
  const today = adenDate(now);
  if (period === "today") return { from: today, to: today };
  if (period === "month") return { from: today.slice(0, 7) + "-01", to: today };
  return { from: adenDate(new Date(now.getTime() - 6 * 86_400_000)), to: today };
}
function stateLabel(item: PartnerFinancialActivityRecord): string {
  if (item.kind === "CASH_COMMISSION") return item.direction === "CREDIT" ? "رصيد وذمة عمولة" : item.direction === "NONE" ? "بدون حركة رصيد" : "ذمة عمولة";
  if (item.kind === "ORDER") return "مستحق مثبت";
  if (item.status === "COMPLETED") return "تم الصرف";
  if (item.status === "CANCELLED") return "ملغى";
  if (item.status === "EXCEPTION") return "يحتاج مراجعة";
  return "قيد الصرف";
}
function itemTitle(item: PartnerFinancialActivityRecord): string {
  return item.kind === "PAYOUT" ? "صرف مستحقات" : item.kind === "CASH_COMMISSION" ? "تسوية طلب نقدي" : "مستحقات طلب";
}
function reference(item: PartnerFinancialActivityRecord): string {
  return item.kind === "PAYOUT" ? (item.id.split(":")[0] ?? item.id) : item.id;
}
function amountPrefix(item: PartnerFinancialActivityRecord): string {
  if (item.direction === "CREDIT") return "+";
  if (item.direction === "DEBIT" || item.direction === "RECEIVABLE") return "−";
  return "";
}
function paymentLabel(item: PartnerFinancialActivityRecord): string {
  return payments.find((option) => option.id === item.paymentMethod)?.label ?? (item.kind === "PAYOUT" ? "الصرف" : "—");
}
function dateLabel(value: string): string {
  try { return new Date(value).toLocaleString("ar-YE", { timeZone: "Asia/Aden", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); }
  catch { return value; }
}
function money(value: number): string { return formatMoney(value, "YER"); }
function buildFilters(selection: Selection, search: string): PartnerFinancialActivityFilters {
  return {
    ...(selection.storeId ? { storeId: selection.storeId } : {}),
    ...(selection.kind ? { kind: selection.kind } : {}),
    ...(selection.status ? { status: selection.status } : {}),
    ...(selection.paymentMethod ? { paymentMethod: selection.paymentMethod } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...range(selection.period), limit: pageSize,
  };
}

function ChoiceRow({ title, options, value, onSelect, theme, styles }: {
  title: string; options: ReadonlyArray<{ id: string; label: string }>; value: string;
  onSelect: (value: string) => void; theme: ReturnType<typeof resolveTheme>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return <View style={styles.group}>
    <Text style={styles.groupTitle}>{title}</Text>
    <View style={styles.chips}>
      {options.map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: option.id === value }} onPress={() => onSelect(option.id)} style={[styles.chip, option.id === value && styles.selectedChip]}>
        <Text style={[styles.chipText, option.id === value && { color: theme.interactiveText }]}>{option.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}

export function PartnerFinancialActivity({ stores }: { stores: PartnerScopedFinancialSummary["stores"] }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [selection, setSelection] = useState<Selection>(initial);
  const [draft, setDraft] = useState<Selection>(initial);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState<PartnerFinancialActivityRecord | null>(null);
  const [items, setItems] = useState<PartnerFinancialActivityRecord[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const activityClient = useMemo(() => {
    const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    return baseUrl ? createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() }) : null;
  }, []);

  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 350); return () => clearTimeout(timer); }, [query]);
  const activeFilters = useMemo(() => buildFilters(selection, debounced), [selection, debounced]);
  const load = useCallback(async (nextCursor = "") => {
    const current = nextCursor ? generation.current : ++generation.current;
    if (nextCursor) setLoadingMore(true);
    else { setLoading(true); setItems([]); setCursor(""); }
    setError("");
    try {
      if (!activityClient) throw new Error("DSH_BASE_URL_REQUIRED");
      const token = await getUsableIdentityAccessToken();
      const response = await activityClient.listOwnPartnerFinancialActivity(token, { ...activeFilters, ...(nextCursor ? { cursor: nextCursor } : {}) });
      if (generation.current !== current) return;
      setItems((previous) => nextCursor ? [...previous, ...response.items.filter((item) => !previous.some((old) => old.kind === item.kind && old.id === item.id))] : [...response.items]);
      setCursor(response.nextCursor ?? "");
    } catch (cause) {
      console.error("Partner finance activity readback failed", cause);
      if (generation.current === current) setError("تعذر قراءة الحركات المالية. حاول مرة أخرى.");
    } finally {
      if (generation.current === current) { setLoading(false); setLoadingMore(false); }
    }
  }, [activityClient, activeFilters]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));
  const applyFilter = () => { setSelection(draft); setFilterOpen(false); };
  const storeOptions = [{ id: "", label: "جميع المتاجر" }, ...stores.map((store) => ({ id: store.storeId, label: store.storeName }))];
  const activeCount = [selection.storeId, selection.kind, selection.status, selection.paymentMethod].filter(Boolean).length;
  const rows = items.map((item) => {
    const credit = item.direction === "CREDIT";
    const caution = item.direction === "RECEIVABLE" || item.status === "EXCEPTION";
    const color = credit ? theme.success : caution ? theme.warning : theme.color;
    return <Pressable key={item.kind + ":" + item.id} accessibilityRole="button" accessibilityLabel={itemTitle(item) + " " + reference(item) + " " + stateLabel(item)} onPress={() => setDetail(item)} style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.rowHeading}><BthwaniIcon name={item.kind === "PAYOUT" ? "wallet" : "orders"} size={18} color={theme.brandAction} /><Text style={styles.rowTitle} numberOfLines={1}>{itemTitle(item)} · #{reference(item)}</Text></View>
        <Text style={[styles.amount, { color }]}>{amountPrefix(item)}{money(item.amountMinor)}</Text>
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.secondary} numberOfLines={1}>{item.storeName} · {paymentLabel(item)}</Text>
        <Text style={[styles.state, { color }]}>{stateLabel(item)}</Text>
      </View>
      <View style={styles.rowBottom}>
        <Text style={styles.secondary}>{dateLabel(item.createdAt)}</Text>
        {item.kind === "ORDER" ? <Text style={styles.secondary}>المنتجات {money(item.grossMinor)} · العمولة {money(item.commissionMinor)}</Text> : item.kind === "CASH_COMMISSION" ? <Text style={styles.secondary}>المبيعات {money(item.grossMinor)} · عمولة مستحقة للمنصة</Text> : <Text style={styles.secondary}>حالة التحويل: {stateLabel(item)}</Text>}
      </View>
    </Pressable>;
  });
  return <View style={styles.root}>
    <View style={styles.sectionHeader}><Text style={styles.title}>الكشف المالي</Text><Text style={styles.secondary}>حسب المتجر والفترة</Text></View>
    <View style={styles.searchRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={"الفلاتر المتقدمة" + (activeCount ? " (" + activeCount + ")" : "")} onPress={() => { setDraft(selection); setFilterOpen(true); }} style={styles.filterButton}><BthwaniIcon name="categories" size={19} color={theme.brandAction} /><Text style={styles.filterLabel}>{activeCount ? "فلتر " + activeCount : "تصفية"}</Text></Pressable>
      <View style={styles.searchBox}><TextInput accessibilityLabel="ابحث برقم الطلب أو مرجع الصرف" value={query} onChangeText={setQuery} placeholder="رقم الطلب أو الصرف..." placeholderTextColor={theme.colorMuted} style={styles.searchInput} returnKeyType="search" /><BthwaniIcon name="search" size={18} color={theme.colorMuted}/></View>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFilters}>
      {[{ id: "", label: "الكل" }, { id: "ORDER", label: "طلبات" }, { id: "PAYOUT", label: "صرف" }, { id: "CASH_COMMISSION", label: "عمولات" }].map((option) =>
        <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: selection.kind === option.id }} onPress={() => setSelection((current) => ({ ...current, kind: option.id }))} style={[styles.chip, selection.kind === option.id && styles.selectedChip]}>
          <Text style={[styles.chipText, selection.kind === option.id && { color: theme.interactiveText }]}>{option.label}</Text>
        </Pressable>)}
    </ScrollView>
    <View style={styles.contextRow}>
      <Text style={styles.secondary}>{selection.storeId ? stores.find((store) => store.storeId === selection.storeId)?.storeName : "جميع المتاجر"} · {periods.find((period) => period.id === selection.period)?.label}</Text>
      <Text style={styles.secondary}>{items.length.toLocaleString("ar-YE")}{cursor ? "+" : ""} حركة</Text>
    </View>
    {loading ? <ActivityIndicator accessibilityLabel="جارٍ تحميل الكشف المالي" color={theme.brandAction} /> : null}
    {error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.error}><Text style={styles.errorText}>{error} · إعادة المحاولة</Text></Pressable> : null}
    {!loading && !error && rows.length === 0 ? <Text style={styles.empty}>لا توجد حركات مطابقة. جرّب تغيير الفلاتر.</Text> : null}
    <View style={styles.rows}>{rows}</View>
    {cursor && !loading ? <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void load(cursor)} style={styles.more}>{loadingMore ? <ActivityIndicator color={theme.brandAction}/> : <Text style={styles.moreLabel}>عرض المزيد من الحركات</Text>}</Pressable> : null}
    <Modal transparent animationType="slide" visible={filterOpen} onRequestClose={() => setFilterOpen(false)}>
      <View style={styles.overlay}><Pressable accessibilityLabel="إغلاق الفلاتر" accessibilityRole="button" style={styles.dismiss} onPress={() => setFilterOpen(false)} />
        <View style={styles.sheet}><View style={styles.sheetHeader}><Pressable accessibilityRole="button" onPress={() => setFilterOpen(false)}><BthwaniIcon name="close" color={theme.color} size={22}/></Pressable><Text style={styles.title}>فلترة الكشف المالي</Text><Pressable accessibilityRole="button" onPress={() => setDraft(initial)}><Text style={styles.reset}>إعادة تعيين</Text></Pressable></View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <ChoiceRow title="الفترة" options={periods} value={draft.period} onSelect={(period) => setDraft((current) => ({ ...current, period: period as Period }))} theme={theme} styles={styles}/>
            <ChoiceRow title="المتجر" options={storeOptions} value={draft.storeId} onSelect={(storeId) => setDraft((current) => ({ ...current, storeId }))} theme={theme} styles={styles}/>
            <ChoiceRow title="نوع الحركة" options={kinds} value={draft.kind} onSelect={(kind) => setDraft((current) => ({ ...current, kind }))} theme={theme} styles={styles}/>
            <ChoiceRow title="الحالة المالية" options={statuses} value={draft.status} onSelect={(status) => setDraft((current) => ({ ...current, status }))} theme={theme} styles={styles}/>
            <ChoiceRow title="طريقة الدفع" options={payments} value={draft.paymentMethod} onSelect={(paymentMethod) => setDraft((current) => ({ ...current, paymentMethod }))} theme={theme} styles={styles}/>
          </ScrollView>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={applyFilter}><Text style={styles.primaryLabel}>عرض النتائج</Text></Pressable>
        </View>
      </View>
    </Modal>
    <Modal transparent animationType="slide" visible={Boolean(detail)} onRequestClose={() => setDetail(null)}>
      <View style={styles.overlay}><Pressable accessibilityRole="button" accessibilityLabel="إغلاق التفاصيل" style={styles.dismiss} onPress={() => setDetail(null)}/>
        <View style={styles.sheet}><View style={styles.sheetHeader}><Pressable onPress={() => setDetail(null)} accessibilityRole="button"><BthwaniIcon name="close" color={theme.color} size={22}/></Pressable><Text style={styles.title}>تفاصيل الحركة المالية</Text><View style={{width:22}}/></View>
          {detail ? <ScrollView contentContainerStyle={styles.sheetBody}>
            <View style={styles.detailHero}><Text style={styles.secondary}>{itemTitle(detail)}</Text><Text style={styles.bigAmount}>{amountPrefix(detail)}{money(detail.amountMinor)}</Text><Text style={styles.secondary}>{stateLabel(detail)}</Text></View>
            {[
              ["المتجر", detail.storeName],
              ["رقم المرجع", reference(detail)],
              ["التاريخ", dateLabel(detail.createdAt)],
              ["طريقة الدفع", paymentLabel(detail)],
              ["الحالة", stateLabel(detail)],
              ...(detail.kind !== "PAYOUT" ? [["إجمالي المنتجات", money(detail.grossMinor)], ["عمولة المنصة", money(detail.commissionMinor)]] : []),
              ...(detail.offsetMinor ? [["مقاصة عمولة سابقة", money(detail.offsetMinor)]] : []),
              ["الأثر المالي", detail.direction === "RECEIVABLE" ? "ذمة للمنصة، وليست خصمًا من الرصيد" : detail.direction === "HOLD" ? "حجز مؤقت، وليس صرفًا مكتملًا" : detail.direction === "DEBIT" ? "صرف مكتمل" : detail.direction === "NONE" ? "لا حركة مباشرة على رصيد المحفظة" : "إضافة مثبتة للرصيد"],
              ...(detail.ledgerTransactionId ? [["مرجع القيد", detail.ledgerTransactionId]] : []),
            ].map(([label, value]) => <View key={label} style={styles.detailLine}><Text style={styles.secondary}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>)}
          </ScrollView> : null}
        </View>
      </View>
    </Modal>
  </View>;
}
function makeStyles(t: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  root: { gap: 10, paddingTop: 4, paddingBottom: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { ...typography.titleSm, color: t.color },
  secondary: { ...typography.caption, color: t.colorMuted, writingDirection: "rtl" },
  searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  filterButton: { minHeight: 46, borderWidth: 1, borderColor: t.borderColor, backgroundColor: t.surface, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  filterLabel: { ...typography.bodySm, color: t.color },
  searchBox: { flex: 1, minHeight: 46, backgroundColor: t.surfaceRaised, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  searchInput: { flex: 1, color: t.color, fontSize: 14, textAlign: "right", minHeight: 44 },
  quickFilters: { gap: 6, paddingVertical: 3 },
  contextRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { minHeight: 36, minWidth: 56, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: t.surfaceRaised, borderWidth: 1, borderColor: t.borderColor, paddingHorizontal: 11 },
  selectedChip: { backgroundColor: t.actionSoft, borderColor: t.brandAction },
  chipText: { ...typography.bodySm, color: t.color },
  rows: { gap: 0, borderRadius: 13, borderColor: t.borderColor, borderWidth: 1, overflow: "hidden", backgroundColor: t.surface },
  row: { gap: 6, paddingHorizontal: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.borderColor, minHeight: 102 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 7 },
  rowHeading: { flexDirection: "row", gap: 6, alignItems: "center", flex: 1 },
  rowTitle: { ...typography.bodyStrong, color: t.color, flexShrink: 1, writingDirection: "rtl" },
  amount: { ...typography.bodyStrong, fontSize: 16 },
  rowMeta: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  state: { ...typography.caption },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", gap: 5, flexWrap: "wrap", paddingTop: 2 },
  more: { minHeight: 44, borderWidth: 1, borderColor: t.borderColor, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  moreLabel: { ...typography.label, color: t.brandAction },
  error: { borderRadius: 10, backgroundColor: t.dangerSoft, padding: 12 },
  errorText: { ...typography.bodySm, color: t.danger },
  empty: { ...typography.bodySm, color: t.colorMuted, textAlign: "center", padding: 18 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: t.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 24, maxHeight: "84%", gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sheetBody: { gap: 17, paddingBottom: 18 },
  group: { gap: 8 },
  groupTitle: { ...typography.bodyStrong, color: t.color, textAlign: "right" },
  reset: { ...typography.label, color: t.brandAction },
  primaryButton: { minHeight: 48, borderRadius: 12, backgroundColor: t.brandAction, alignItems: "center", justifyContent: "center" },
  primaryLabel: { ...typography.bodyStrong, color: t.onAction },
  detailHero: { backgroundColor: t.actionSoft, borderRadius: 14, gap: 5, alignItems: "center", padding: 18 },
  bigAmount: { color: t.color, fontSize: 25, fontWeight: "800" },
  detailLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.borderColor },
  detailValue: { ...typography.bodySm, color: t.color, flexShrink: 1, textAlign: "left" },
}); }
