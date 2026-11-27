import { type MerchantCatalogOffer, type MerchantCatalogPage, type MerchantCatalogStatus, validMerchantCatalogSearch } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, Text, TextInput, View } from "react-native";
import type { MerchantDSHStanding } from "../access/dsh-standing";
import CatalogDraftHistory from "./catalog-draft-history";
import CatalogExport from "./catalog-export";
import CatalogImport from "./catalog-import";
import { readMerchantCatalogPage } from "./catalog-transport";
import InventorySummary from "./inventory-summary";
import MerchantCatalogDraftForm from "./merchant-catalog-draft-form";

type CatalogState = {
  scope: string;
  loading: boolean;
  more: boolean;
  items: MerchantCatalogOffer[];
  cursor?: string | undefined;
  error?: string | undefined;
};

const statusFilters: ReadonlyArray<{ value: MerchantCatalogStatus | undefined; label: string }> = [
  { value: undefined, label: "كل العروض" },
  { value: "unpublished", label: "غير المنشورة" },
  { value: "published", label: "المنشورة" },
  { value: "available", label: "المتاحة" },
  { value: "unavailable", label: "غير المتاحة" },
  { value: "stockout", label: "نفد المخزون" },
];

function canEditDraft(offer: MerchantCatalogOffer) {
  return !offer.published && !offer.available && !offer.productActive &&
    !offer.variantSellable && !offer.requiredAttributesValid &&
    /^of-[a-f0-9]{32}$/.test(offer.id);
}

export default function MerchantPrivateCatalog({ actorId, stores, initialStoreId = "", initialPriceStockOnly = false, inventoryOnly = false, initialStatus }: Readonly<{
  actorId: string;
  stores: MerchantDSHStanding["stores"];
  initialStoreId?: string | undefined;
  initialPriceStockOnly?: boolean;
  inventoryOnly?: boolean;
  initialStatus?: MerchantCatalogStatus | undefined;
}>) {
  const { theme } = useMobileAppearance();
  const [selectedId, setSelectedId] = useState(initialStoreId);
  const [search, setSearch] = useState({ scope: "", draft: "", query: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ scope: string; offerId: string } | null>(null);
  const [priceScope, setPriceScope] = useState<string | null>(
    initialPriceStockOnly && initialStoreId ? JSON.stringify([actorId, initialStoreId]) : null,
  );
  const [filter, setFilter] = useState<{ scope: string; status: MerchantCatalogStatus | undefined }>({
    scope: initialStoreId ? JSON.stringify([actorId, initialStoreId]) : "", status: initialStatus,
  });
  const [retry, setRetry] = useState(0);
  const [verifiedStoreScope, setVerifiedStoreScope] = useState<string | null>(null);
  const [state, setState] = useState<CatalogState>({
    scope: "", loading: false, more: false, items: [],
  });
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const selected = selectedId ? stores.find(store => store.id === selectedId) : stores[0];
  const storeId = selected?.id ?? "";
  const storeScope = JSON.stringify([actorId, storeId]);
  const priceStockOnly = inventoryOnly || priceScope === storeScope;
  const catalogVerified = Boolean(storeId && actorId && verifiedStoreScope === storeScope);
  // Products reset optional focus on scope changes; the dedicated Inventory destination stays focused.
  useEffect(() => {
    setPriceScope(previous => previous === storeScope ? previous : null);
    setVerifiedStoreScope(previous => previous === storeScope ? previous : null);
    setFilter(previous => previous.scope === storeScope ? previous : { scope: "", status: undefined });
  }, [storeScope]);
  const draftSearch = search.scope === storeScope ? search.draft : "";
  const searchQuery = search.scope === storeScope ? search.query : "";
  const status = filter.scope === storeScope ? filter.status : undefined;
  const scope = JSON.stringify([actorId, storeId, searchQuery, status]);
  const historyScope = JSON.stringify([scope, retry]);
  useEffect(() => {
    const reload = () => setRetry(value => value + 1);
    if (Platform.OS === "web") {
      window.addEventListener("focus", reload);
      return () => window.removeEventListener("focus", reload);
    }
    const listener = AppState.addEventListener("change", status => {
      if (status === "active") reload();
    });
    return () => listener.remove();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry intentionally refreshes the current DSH catalog page.
  useEffect(() => {
    const epoch = ++generation.current;
    active.current?.abort();
    setEditingId(null);
    setHistory(null);
    if (!actorId || !storeId) {
      setState({ scope, loading: false, more: false, items: [] });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setState({ scope, loading: true, more: false, items: [] });
    void readMerchantCatalogPage(storeId, actorId, controller.signal, { limit: 20, ...(searchQuery ? { query: searchQuery } : {}), ...(status ? { status } : {}) })
      .then(page => {
        if (controller.signal.aborted || epoch !== generation.current) return;
        setVerifiedStoreScope(storeScope);
        setState({ scope, loading: false, more: false, items: page.items,
          ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });
      })
      .catch(() => {
        if (controller.signal.aborted || epoch !== generation.current) return;
        setVerifiedStoreScope(null);
        setState({ scope, loading: false, more: false, items: [],
          error: "تعذّر التحقق من كتالوج هذا المتجر لدى DSH. تأكد من الصلاحية والاتصال." });
      });
    return () => { active.current?.abort(); active.current = null; generation.current++; };
  }, [scope, storeId, actorId, storeScope, searchQuery, status, retry]);

  const visible: CatalogState = state.scope === scope ? state : {
    scope, loading: true, more: false, items: [],
  };
  const button = { minHeight: 44, borderWidth: 1, borderColor: theme.borderColor,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    justifyContent: "center" as const };

  const renderedGeneration = generation.current;
  async function more() {
    // Consume the rendered continuation before it can abort a newer owner read.
    if (!storeId || !visible.cursor || visible.loading || visible.more || renderedGeneration !== generation.current) return;
    const cursor = visible.cursor;
    const epoch = ++generation.current;
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    setState(previous => previous.scope === scope ? { ...previous, more: true } : previous);
    try {
      const page: MerchantCatalogPage = await readMerchantCatalogPage(storeId, actorId, controller.signal,
        { cursor, limit: 20, ...(searchQuery ? { query: searchQuery } : {}), ...(status ? { status } : {}) });
      if (controller.signal.aborted || epoch !== generation.current) return;
      if (page.items.some(item => item.id <= cursor) || (page.nextCursor && page.nextCursor <= cursor)) {
        throw new Error("CATALOG_CURSOR_INVALID");
      }
      setState(previous => {
        if (previous.scope !== scope || previous.cursor !== cursor) return previous;
        return { ...previous, more: false, items: [...previous.items, ...page.items],
          cursor: page.nextCursor, error: undefined };
      });
    } catch {
      if (controller.signal.aborted || epoch !== generation.current) return;
      // A failed owner read cannot extend the verified scope of the previous page.
      // Discard that projection and its subordinate controls until a fresh read.
      setVerifiedStoreScope(null);
      setEditingId(null);
      setState({ scope, loading: false, more: false, items: [],
        error: "تعذّر التحقق من الصفحة التالية لدى DSH. أعد تحميل كتالوج المتجر." });
    }
  }

  return <View testID="merchant-private-catalog" style={{ gap: 14 }}>
    <Text style={{ color: theme.colorSecondary, lineHeight: 24 }}>
      يعرض DSH منتجات وعروض متجرك. يمكن تعديل المسودات المؤهلة، أما العروض المنشورة فتظل للقراءة فقط.
    </Text>
    {selectedId && !selected ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
      المتجر المحدد غير متاح في حسابك الآن.
    </Text> : null}
    {stores.length === 0 ? <Text style={{ color: theme.color }}>سجّل متجرًا لعرض كتالوجه.</Text> :
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {stores.map(store => <Pressable key={store.id} accessibilityRole="button"
          accessibilityLabel={`كتالوج ${store.name}`}
          accessibilityState={{ selected: store.id === storeId }}
          onPress={() => setSelectedId(store.id)}
          style={{ ...button, backgroundColor: store.id === storeId ? theme.actionSoft : theme.surface }}>
          <Text style={{ color: theme.color }}>{store.name}</Text>
        </Pressable>)}
      </View>}
    {storeId && actorId && !inventoryOnly ? <Pressable accessibilityRole="button"
      accessibilityLabel="الأسعار والمخزون للمسودات"
      accessibilityState={{ selected: priceStockOnly }}
      style={{ ...button, backgroundColor: priceStockOnly ? theme.actionSoft : theme.surface }}
      onPress={() => { setEditingId(null); setPriceScope(priceStockOnly ? null : storeScope); }}>
      <Text style={{ color: theme.interactiveText }}>
        {priceStockOnly ? "العودة إلى إدارة المنتجات" : "الأسعار والمخزون للمسودات"}
      </Text>
    </Pressable> : null}
    {priceStockOnly ? <Text style={{ color: theme.colorSecondary }}>
      عدّل سعر ومخزون مسودة واحدة أو استخدم ملف CSV لتعديل المسودات المطابقة جماعيًا بعد مراجعة الصفوف واعتمادها لدى DSH. لا يشمل ذلك إنشاء المنتجات أو تعديل العروض المنشورة.
    </Text> : null}
    {storeId && actorId ? <View style={{ gap: 8 }}>
      <TextInput accessibilityLabel="البحث باسم المنتج" value={draftSearch}
        onChangeText={draft => setSearch({ scope: storeScope, draft, query: searchQuery })}
        placeholder="اسم المنتج" placeholderTextColor={theme.colorSecondary} maxLength={80}
        style={{ ...button, color: theme.color }} />
      <Pressable accessibilityRole="button" accessibilityLabel="بحث في الكتالوج" style={button}
        disabled={!validMerchantCatalogSearch(draftSearch)}
        onPress={() => setSearch({ scope: storeScope, draft: draftSearch, query: draftSearch.trim() })}>
        <Text style={{ color: theme.interactiveText }}>بحث</Text>
      </Pressable>
      {draftSearch || searchQuery ? <Pressable accessibilityRole="button" style={button}
        onPress={() => setSearch({ scope: storeScope, draft: "", query: "" })}>
        <Text style={{ color: theme.interactiveText }}>مسح البحث</Text>
      </Pressable> : null}
    </View> : null}
    {storeId && actorId ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {statusFilters.map(item => <Pressable key={item.value ?? "all"} accessibilityRole="button"
        accessibilityLabel={item.label} accessibilityState={{ selected: status === item.value }}
        onPress={() => setFilter({ scope: storeScope, status: item.value })}
        style={{ ...button, backgroundColor: status === item.value ? theme.actionSoft : theme.surface }}>
        <Text style={{ color: theme.interactiveText }}>{item.label}</Text>
      </Pressable>)}
    </View> : null}
    {catalogVerified ? <InventorySummary key={JSON.stringify([actorId, storeId, retry])}
      actorId={actorId} storeId={storeId} onShowStatus={nextStatus => {
        if (renderedGeneration !== generation.current) return;
        setSearch({ scope: storeScope, draft: "", query: "" });
        setFilter({ scope: storeScope, status: nextStatus });
        if (status === nextStatus && !searchQuery) setRetry(value => value + 1);
      }} /> : null}
    {catalogVerified ? <CatalogExport actorId={actorId} storeId={storeId} query={searchQuery} status={status} /> : null}
    {catalogVerified ? <CatalogImport actorId={actorId} storeId={storeId} onChanged={() => setRetry(value => value + 1)} /> : null}
    {catalogVerified && !priceStockOnly ? <MerchantCatalogDraftForm key={storeScope} actorId={actorId} storeId={storeId}
      onCreated={() => setRetry(value => value + 1)} /> : null}
    {visible.loading ? <ActivityIndicator accessibilityLabel="جارٍ قراءة كتالوج المتجر" /> : null}
    {visible.error ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
      {visible.error}
    </Text> : null}
    {!visible.loading && !visible.error && stores.length > 0 && visible.items.length === 0 ?
      <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
        {searchQuery || status ? "لا توجد عروض مطابقة للبحث أو المرشح." : "لا توجد عروض مسجلة لهذا المتجر حتى الآن."}
      </Text> : null}
    {visible.items.map(offer => <View key={offer.id} style={{
      backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1,
      borderRadius: 12, padding: 15, gap: 8,
    }}>
      <Text style={{ color: theme.color, fontWeight: "700", fontSize: 17 }}>{offer.name}</Text>
      <Text style={{ color: theme.colorSecondary }}>
        {BigInt(offer.priceYer).toLocaleString("ar-YE")} ريال يمني · المخزون: {offer.stockUnits}
      </Text>
      <Text style={{ color: offer.published ? theme.successText : theme.warningText }}>
        {offer.published ? "عرض منشور" : "عرض غير منشور"} · {offer.available ? "التوافر مفعّل" : "التوافر موقوف"}
      </Text>
      {canEditDraft(offer) ?
        <Pressable accessibilityRole="button"
          accessibilityLabel={priceStockOnly ? `تعديل سعر ومخزون ${offer.name}` : `تعديل ${offer.name}`}
          style={button} onPress={() => setEditingId(current => current === offer.id ? null : offer.id)}>
          <Text style={{ color: theme.interactiveText }}>
            {editingId === offer.id ? "إغلاق تعديل المسودة" : priceStockOnly ? "تعديل السعر والمخزون" : "تعديل المسودة"}
          </Text>
        </Pressable> : null}
      {editingId === offer.id && canEditDraft(offer) ?
        <MerchantCatalogDraftForm key={`${storeScope}:${offer.id}:${offer.draftVersion}:${priceStockOnly}`}
          actorId={actorId} storeId={storeId} draft={offer} priceStockOnly={priceStockOnly}
          onCreated={() => { setEditingId(null); setRetry(value => value + 1); }} /> : null}
      {catalogVerified && !visible.loading && canEditDraft(offer) ? <>
        <Pressable accessibilityRole="button"
          accessibilityLabel={`عرض سجل تعديلات ${offer.name}`}
          accessibilityState={{ expanded: history?.scope === historyScope && history.offerId === offer.id }}
          style={button} onPress={() => {
            if (renderedGeneration !== generation.current) return;
            setHistory(previous => previous?.scope === historyScope && previous.offerId === offer.id
              ? null : { scope: historyScope, offerId: offer.id });
          }}>
          <Text style={{ color: theme.interactiveText }}>
            {history?.scope === historyScope && history.offerId === offer.id ? "إغلاق السجل" : "عرض تعديلات المسودة"}
          </Text>
        </Pressable>
        {history?.scope === historyScope && history.offerId === offer.id ?
          <CatalogDraftHistory key={JSON.stringify([historyScope, offer.id])}
            actorId={actorId} storeId={storeId} offerId={offer.id} /> : null}
      </> : null}
      {!offer.productActive || !offer.variantSellable || !offer.requiredAttributesValid ?
        <Text style={{ color: theme.dangerText }}>المنتج أو الصنف غير مؤهل للبيع حاليًا.</Text> : null}
    </View>)}
    {visible.cursor ? <Pressable accessibilityRole="button" onPress={() => void more()}
      disabled={visible.more} style={button}>
      <Text style={{ color: theme.interactiveText }}>
        {visible.more ? "جارٍ التحميل..." : "عرض المزيد"}
      </Text>
    </Pressable> : null}
    {visible.error ? <Pressable accessibilityRole="button"
      onPress={() => setRetry(value => value + 1)} style={button}>
      <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
    </Pressable> : null}
  </View>;
}
