import type { MerchantCatalogOffer, MerchantCatalogPage } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, Text, View } from "react-native";
import { readMerchantCatalogPage } from "./catalog-transport";
import type { MerchantDSHStanding } from "../access/dsh-standing";
import MerchantCatalogDraftForm from "./merchant-catalog-draft-form";

type CatalogState = {
  scope: string;
  loading: boolean;
  more: boolean;
  items: MerchantCatalogOffer[];
  cursor?: string | undefined;
  error?: string | undefined;
};

export default function MerchantPrivateCatalog({ actorId, stores }: Readonly<{
  actorId: string;
  stores: MerchantDSHStanding["stores"];
}>) {
  const { theme } = useMobileAppearance();
  const [selectedId, setSelectedId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<CatalogState>({
    scope: "", loading: false, more: false, items: [],
  });
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const selected = stores.find(store => store.id === selectedId) ?? stores[0];
  const storeId = selected?.id ?? "";
  const scope = `${actorId}:${storeId}`;
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
    if (!actorId || !storeId) {
      setState({ scope, loading: false, more: false, items: [] });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setState({ scope, loading: true, more: false, items: [] });
    void readMerchantCatalogPage(storeId, actorId, controller.signal, { limit: 20 })
      .then(page => {
        if (controller.signal.aborted || epoch !== generation.current) return;
        setState({ scope, loading: false, more: false, items: page.items,
          ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });
      })
      .catch(() => {
        if (controller.signal.aborted || epoch !== generation.current) return;
        setState({ scope, loading: false, more: false, items: [],
          error: "تعذّر التحقق من كتالوج هذا المتجر لدى DSH. تأكد من الصلاحية والاتصال." });
      });
    return () => { controller.abort(); generation.current++; };
  }, [scope, storeId, actorId, retry]);

  const visible: CatalogState = state.scope === scope ? state : {
    scope, loading: true, more: false, items: [],
  };
  const button = { minHeight: 44, borderWidth: 1, borderColor: theme.borderColor,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    justifyContent: "center" as const };

  async function more() {
    if (!storeId || !visible.cursor || visible.loading || visible.more) return;
    const cursor = visible.cursor;
    const epoch = generation.current;
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    setState(previous => previous.scope === scope ? { ...previous, more: true } : previous);
    try {
      const page: MerchantCatalogPage = await readMerchantCatalogPage(storeId, actorId, controller.signal,
        { cursor, limit: 20 });
      if (controller.signal.aborted || epoch !== generation.current) return;
      setState(previous => {
        if (previous.scope !== scope || previous.cursor !== cursor) return previous;
        const known = new Set(previous.items.map(item => item.id));
        if (page.items.some(item => known.has(item.id)) || page.nextCursor === cursor) {
          return { scope, loading: false, more: false, items: [],
            error: "تغيّرت صفحة الكتالوج؛ أعد تحميل بيانات المتجر للتحقق." };
        }
        return { ...previous, more: false, items: [...previous.items, ...page.items],
          cursor: page.nextCursor, error: undefined };
      });
    } catch {
      if (controller.signal.aborted || epoch !== generation.current) return;
      setState(previous => previous.scope === scope ? { ...previous, more: false,
        error: "تعذر تحميل الصفحة التالية. يمكنك إعادة المحاولة." } : previous);
    }
  }

  return <View testID="merchant-private-catalog" style={{ gap: 14 }}>
    <Text style={{ color: theme.colorSecondary, lineHeight: 24 }}>
      يعرض DSH منتجات وعروض متجرك، بما فيها المسودات وغير المنشورة. لا تمنح هذه القراءة صلاحية
      البيع أو تغيير السعر والمخزون حتى تكتمل وظائف إدارة الكتالوج.
    </Text>
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
    {storeId && actorId ? <MerchantCatalogDraftForm key={scope} actorId={actorId} storeId={storeId}
      onCreated={() => setRetry(value => value + 1)} /> : null}
    {visible.loading ? <ActivityIndicator accessibilityLabel="جارٍ قراءة كتالوج المتجر" /> : null}
    {visible.error ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
      {visible.error}
    </Text> : null}
    {!visible.loading && !visible.error && stores.length > 0 && visible.items.length === 0 ?
      <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
        لا توجد عروض مسجلة لهذا المتجر حتى الآن.
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
        {offer.published ? "عرض منشور" : "عرض غير منشور"} · {offer.available ? "متاح" : "موقوف"}
      </Text>
      {!offer.published && !offer.available && !offer.productActive &&
        !offer.variantSellable && !offer.requiredAttributesValid &&
        /^of-[a-f0-9]{32}$/.test(offer.id) ?
        <Pressable accessibilityRole="button" accessibilityLabel={`تعديل ${offer.name}`}
          style={button} onPress={() => setEditingId(current => current === offer.id ? null : offer.id)}>
          <Text style={{ color: theme.interactiveText }}>
            {editingId === offer.id ? "إغلاق تعديل المسودة" : "تعديل المسودة"}
          </Text>
        </Pressable> : null}
      {editingId === offer.id && !offer.published && !offer.available && !offer.productActive &&
        !offer.variantSellable && !offer.requiredAttributesValid ?
        <MerchantCatalogDraftForm key={`${scope}:${offer.id}:${offer.draftVersion}`}
          actorId={actorId} storeId={storeId} draft={offer}
          onCreated={() => { setEditingId(null); setRetry(value => value + 1); }} /> : null}
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
