import type { CatalogActivityItem, CatalogActivityPage } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { catalogActivityDateBound, validCatalogActivityDay } from "./partner-catalog-activity-date";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { listOwnStoreCatalogActivity } from "./store-readback-client";

type ReadState =
  | Readonly<{ kind: "loading" | "error" }>
  | Readonly<{ kind: "ready"; page: CatalogActivityPage }>;
type Filters = Readonly<{ q: string; action: string; from: string; to: string }>;
const empty: Filters = { q: "", action: "", from: "", to: "" };
const labels: Record<string, string> = { created: "إنشاء", updated: "تعديل", migrated: "نقل بيانات" };

function localDate(raw: string) {
  return new Intl.DateTimeFormat("ar-YE", { timeZone: "Asia/Aden", dateStyle: "medium", timeStyle: "short" }).format(new Date(raw));
}

export function PartnerCatalogActivity() {
  const scope = usePartnerStoreScope();
  // Remount query, cursor and visible results whenever the selected Store changes.
  return <PartnerCatalogActivityForStore key={scope.selectedStore?.id ?? ""} scope={scope} />;
}

function PartnerCatalogActivityForStore({ scope }: Readonly<{ scope: ReturnType<typeof usePartnerStoreScope> }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { selectedStore, state: scopeState } = scope;
  const storeID = selectedStore?.id ?? "";
  const allowed = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")));
  const [draft, setDraft] = useState<Filters>(empty);
  const [filters, setFilters] = useState<Filters>(empty);
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<readonly string[]>([]);
  const [retry, setRetry] = useState(0);
  const [read, setRead] = useState<ReadState>({ kind: "loading" });
  const [expanded, setExpanded] = useState("");
  const [inputError, setInputError] = useState("");

  useFocusEffect(useCallback(() => {
    // Retain the explicit retry generation so the active screen re-reads DSH on demand.
    void retry;
    if (!allowed || !storeID) return;
    let active = true;
    setRead({ kind: "loading" });
    void listOwnStoreCatalogActivity(storeID, {
      q: filters.q, action: filters.action, cursor, limit: 20,
      from: catalogActivityDateBound(filters.from, false), to: catalogActivityDateBound(filters.to, true),
    }).then(page => {
      if (active) setRead({ kind: "ready", page });
    }).catch(() => {
      if (active) setRead({ kind: "error" });
    });
    return () => { active = false; };
  }, [allowed, storeID, filters, cursor, retry]));

  const apply = () => {
    if (!validCatalogActivityDay(draft.from) || !validCatalogActivityDay(draft.to) || (draft.from && draft.to && draft.from > draft.to)) {
      setInputError("أدخل تاريخًا صحيحًا بصيغة YYYY-MM-DD، على ألا يسبق تاريخ النهاية البداية.");
      return;
    }
    setInputError("");
    setCursor("");
    setPrevious([]);
    setExpanded("");
    setFilters(draft);
    setRetry(value => value + 1);
  };
  const page = read.kind === "ready" ? read.page : null;
  return <View style={styles.container} accessibilityLabel="سجل تغييرات عروض المتجر">
    <Text accessibilityRole="header" style={styles.sectionTitle}>سجل تغييرات عروض المتجر</Text>
    <Text style={styles.muted}>يعرض العمليات المسجلة على أسعار وعروض المتجر المحدد، وليس جميع أنشطة الحساب.</Text>
    {scopeState.kind === "loading" ? <Text style={styles.muted}>جارٍ تحديد المتجر...</Text> : null}
    {scopeState.kind === "error" ? <Text style={styles.error}>تعذر تحديد المتجر الحالي. أعد فتح الصفحة بعد استعادة الاتصال.</Text> : null}
    {scopeState.kind === "ready" && !selectedStore ? <Text style={styles.muted}>لا توجد متاجر مرتبطة بحسابك.</Text> : null}
    {selectedStore && !allowed ? <Text style={styles.error}>ليس لديك إذن عرض تغييرات الكتالوج في هذا المتجر.</Text> : null}
    {selectedStore && allowed ? <>
      <View style={styles.card}>
        <Text style={styles.value}>المتجر: {selectedStore.name}</Text>
        <Text style={styles.metaLabel}>بحث باسم المنتج أو معرف المنفذ</Text>
        <TextInput accessibilityLabel="بحث في نشاط المتجر" style={styles.formInput} value={draft.q} maxLength={120} placeholder="بحث في السجل" placeholderTextColor={theme.colorMuted} onChangeText={q => setDraft(current => ({ ...current, q }))} />
        <Text style={styles.metaLabel}>نوع الإجراء</Text>
        <View style={styles.choiceRow}>
          {["", "created", "updated", "migrated"].map(action =>
            <Pressable key={action} accessibilityRole="button" accessibilityState={{ selected: draft.action === action }}
              accessibilityLabel={labels[action] || "الكل"} onPress={() => setDraft(current => ({ ...current, action }))}
              style={[styles.choice, draft.action === action && styles.choiceSelected]}>
              <Text style={draft.action === action ? styles.choiceTextSelected : styles.choiceText}>{labels[action] || "الكل"}</Text>
            </Pressable>)}
        </View>
        <Text style={styles.metaLabel}>من تاريخ (YYYY-MM-DD)</Text>
        <TextInput accessibilityLabel="تاريخ بداية السجل" style={styles.formInput} value={draft.from} maxLength={10} placeholder="2026-11-01" placeholderTextColor={theme.colorMuted} autoCapitalize="none" onChangeText={from => setDraft(current => ({ ...current, from }))} />
        <Text style={styles.metaLabel}>إلى تاريخ (YYYY-MM-DD)</Text>
        <TextInput accessibilityLabel="تاريخ نهاية السجل" style={styles.formInput} value={draft.to} maxLength={10} placeholder="2026-11-30" placeholderTextColor={theme.colorMuted} autoCapitalize="none" onChangeText={to => setDraft(current => ({ ...current, to }))} />
        {inputError ? <Text style={styles.error} accessibilityRole="alert">{inputError}</Text> : null}
        <View style={styles.choiceRow}>
          <BthwaniButton label="بحث وتصفية" onPress={apply} />
          <BthwaniButton label="مسح" variant="secondary" onPress={() => {
            setDraft(empty); setFilters(empty); setCursor(""); setPrevious([]); setExpanded(""); setInputError(""); setRetry(value => value + 1);
          }} />
        </View>
      </View>
      {read.kind === "loading" ? <Text style={styles.muted} accessibilityLiveRegion="polite">جارٍ قراءة سجل المتجر...</Text> : null}
      {read.kind === "error" ? <View style={styles.card}>
        <Text style={styles.error} accessibilityRole="alert">تعذر تحميل السجل، ولم تُفترض أي بيانات.</Text>
        <BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => setRetry(value => value + 1)} />
      </View> : null}
      {page && !page.items.length ? <Text style={styles.muted}>لا توجد أحداث مطابقة للبحث.</Text> : null}
      {page?.items.map((item: CatalogActivityItem) => <View key={item.id} style={styles.card}>
        <Text style={styles.value}>{item.subject}</Text>
        <Text style={styles.muted}>{labels[item.action] || item.action} · {localDate(item.at)}</Text>
        <Text style={styles.metaLabel}>المنفذ: {item.actorId}</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === item.id }} onPress={() => setExpanded(value => value === item.id ? "" : item.id)}>
          <Text style={styles.choiceText}>{expanded === item.id ? "إخفاء التفاصيل" : "عرض التفاصيل"}</Text>
        </Pressable>
        {expanded === item.id ? <View style={styles.metaItem}>
          <Text style={styles.muted}>رقم الحدث: {item.id}</Text>
          <Text style={styles.muted}>الإصدار: {item.version}</Text>
          {item.fromState ? <Text style={styles.muted}>الحالة السابقة: {item.fromState}</Text> : null}
          {item.toState ? <Text style={styles.muted}>الحالة الجديدة: {item.toState}</Text> : null}
          {item.previousPriceMinor != null ? <Text style={styles.muted}>السعر السابق: {item.previousPriceMinor.toLocaleString("ar-YE")} ر.ي</Text> : null}
          {item.priceMinor != null ? <Text style={styles.muted}>السعر الجديد: {item.priceMinor.toLocaleString("ar-YE")} ر.ي</Text> : null}
        </View> : null}
      </View>)}
      {page ? <View style={styles.choiceRow}>
        {previous.length ? <BthwaniButton label="السابق" variant="secondary" onPress={() => { setPrevious(stack => stack.slice(0, -1)); setCursor(previous[previous.length - 1] ?? ""); setExpanded(""); }} /> : null}
        {page.nextCursor ? <BthwaniButton label="التالي" variant="secondary" onPress={() => { setPrevious(stack => [...stack, cursor]); setCursor(page.nextCursor); setExpanded(""); }} /> : null}
        <Text style={styles.muted}>أحداث الصفحة: {page.items.length}</Text>
      </View> : null}
    </> : null}
  </View>;
}
