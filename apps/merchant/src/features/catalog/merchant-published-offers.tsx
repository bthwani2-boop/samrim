import { listPublicOffers, type PublicOffer, type PublicPage } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, Text, TextInput, View } from "react-native";
import type { MerchantDSHStanding } from "../access/dsh-standing";

type OffersState = {
  scope: string;
  loading: boolean;
  loadingMore: boolean;
  items: PublicOffer[];
  revision?: number;
  cursor?: string | undefined;
  error?: string | undefined;
};

const pageSize = 20;
const origin = Platform.OS === "web"
  ? (typeof window === "undefined" ? "" : window.location.origin)
  : process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN ?? "";

function formatPrice(value: PublicOffer["priceYer"]): string {
  return (typeof value === "string" ? BigInt(value) : value).toLocaleString("ar-YE");
}

/** Public published offers only. Store ownership is supplied by the already verified
 * Identity + DSH Merchant standing; this never grants editing or draft access. */
export default function MerchantPublishedOffers({ actorId, stores }: Readonly<{
  actorId: string;
  stores: MerchantDSHStanding["stores"];
}>) {
  const { theme } = useMobileAppearance();
  const [selectedId, setSelectedId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<OffersState>({
    scope: "", loading: false, loadingMore: false, items: [],
  });
  const activeRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const publishedStores = stores.filter(store => store.published);
  const selected = publishedStores.find(store => store.id === selectedId) ?? publishedStores[0];
  const storeId = selected?.id ?? "";
  const scope = JSON.stringify([actorId, storeId, searchQuery]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reloads the current owner-backed Store page.
  useEffect(() => {
    const current = ++generation.current;
    activeRequest.current?.abort();
    if (!actorId || !storeId) {
      setState({ scope, loading: false, loadingMore: false, items: [] });
      return;
    }
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ scope, loading: true, loadingMore: false, items: [] });
    void listPublicOffers(origin, storeId, {
      limit: pageSize, signal: controller.signal,
      ...(searchQuery ? { query: searchQuery } : {}),
    })
      .then(page => {
        if (controller.signal.aborted || current !== generation.current) return;
        setState({ scope, loading: false, loadingMore: false, items: page.items,
          revision: page.revision, cursor: page.nextCursor });
      })
      .catch(() => {
        if (controller.signal.aborted || current !== generation.current) return;
        setState({ scope, loading: false, loadingMore: false, items: [],
          error: "تعذرت قراءة المنتجات المنشورة من DSH. تحقق من الاتصال ثم أعد المحاولة." });
      });
    return () => controller.abort();
  }, [actorId, storeId, scope, retry]);

  const visible: OffersState = state.scope === scope ? state :
    { scope, loading: true, loadingMore: false, items: [] };
  const button = {
    minHeight: 44, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderColor: theme.borderColor, borderWidth: 1,
    justifyContent: "center" as const,
  };
  const card = {
    borderRadius: 12, borderWidth: 1, borderColor: theme.borderColor,
    padding: 16, backgroundColor: theme.surface, gap: 6,
  };

  async function loadMore() {
    if (!storeId || visible.loading || visible.loadingMore || !visible.cursor) return;
    const cursor = visible.cursor;
    const current = generation.current;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setState(previous => previous.scope === scope ?
      { ...previous, loadingMore: true, error: undefined } : previous);
    try {
      const page: PublicPage<PublicOffer> = await listPublicOffers(origin, storeId, {
        cursor, limit: pageSize, signal: controller.signal,
        ...(searchQuery ? { query: searchQuery } : {}),
      });
      if (controller.signal.aborted || generation.current !== current) return;
      setState(previous => {
        if (previous.scope !== scope || previous.cursor !== cursor) return previous;
        const priorIds = new Set(previous.items.map(offer => offer.id));
        if (page.revision !== previous.revision ||
          (page.nextCursor !== undefined && page.nextCursor === cursor) ||
          page.items.some(offer => priorIds.has(offer.id))) {
          return { scope, loading: false, loadingMore: false, items: [],
            error: "تغيّرت قائمة DSH أثناء التصفح. أعد تحميلها للحصول على نسخة متسقة." };
        }
        return { ...previous, loadingMore: false, items: [...previous.items, ...page.items],
          cursor: page.nextCursor, error: undefined };
      });
    } catch {
      if (controller.signal.aborted || generation.current !== current) return;
      setState(previous => previous.scope === scope ?
        { ...previous, loadingMore: false,
          error: "تعذر تحميل المزيد من DSH. أعد المحاولة." } : previous);
    }
  }

  return (
    <View testID="merchant-published-offers" style={{ gap: 16 }}>
      <Text style={{ color: theme.colorSecondary, lineHeight: 24 }}>
        تعرض هذه القائمة العروض المنشورة من DSH فقط. المنتجات غير المنشورة وتعديل الأسعار والمخزون تحتاج إلى عقود الإدارة المعتمدة.
      </Text>
      {publishedStores.length === 0 ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
          لا يوجد متجر منشور مرتبط بحساب التاجر الحالي.
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {publishedStores.map(store => (
              <Pressable key={store.id} accessibilityRole="button"
                accessibilityState={{ selected: store.id === storeId }}
                onPress={() => setSelectedId(store.id)}
                style={{ ...button, backgroundColor: store.id === storeId ? theme.actionSoft : theme.surface }}>
                <Text style={{ color: store.id === storeId ? theme.interactiveText : theme.color }}>
                  {store.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <TextInput testID="merchant-offers-search" accessibilityLabel="البحث في العروض المنشورة"
              placeholder="ابحث عن عرض منشور" placeholderTextColor={theme.colorSecondary}
              value={searchText} onChangeText={setSearchText} maxLength={80}
              onSubmitEditing={() => setSearchQuery(searchText.trim())}
              style={{ ...button, minWidth: 220, flexGrow: 1, backgroundColor: theme.surface, color: theme.color }} />
            <Pressable accessibilityRole="button" onPress={() => setSearchQuery(searchText.trim())}
              style={button}>
              <Text style={{ color: theme.interactiveText }}>بحث</Text>
            </Pressable>
            {searchQuery || searchText ? (
              <Pressable accessibilityRole="button" onPress={() => {
                setSearchText("");
                setSearchQuery("");
              }} style={button}>
                <Text style={{ color: theme.interactiveText }}>إلغاء البحث</Text>
              </Pressable>
            ) : null}
          </View>
          {visible.loading ? <ActivityIndicator accessibilityLabel="جارٍ تحميل المنتجات المنشورة" /> : (
            <>
              {visible.error ? (
                <Text accessibilityLiveRegion="polite" style={{ color: theme.warningText }}>
                  {visible.error}
                </Text>
              ) : null}
              {!visible.error && visible.items.length === 0 ? (
                <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
                  {searchQuery ? "لا توجد عروض منشورة تطابق البحث لهذا المتجر." : "لا توجد عروض منشورة لهذا المتجر حاليًا."}
                </Text>
              ) : null}
              {visible.items.map(offer => (
                <View key={offer.id} style={card}>
                  <Text style={{ color: theme.color, fontSize: 18, fontWeight: "700" }}>
                    {offer.name}
                  </Text>
                  <Text style={{ color: theme.colorSecondary }}>
                    {formatPrice(offer.priceYer)} ريال يمني
                  </Text>
                </View>
              ))}
              {visible.cursor ? (
                <Pressable accessibilityRole="button" disabled={visible.loadingMore}
                  onPress={() => void loadMore()} style={button}>
                  <Text style={{ color: theme.interactiveText }}>
                    {visible.loadingMore ? "جارٍ التحميل..." : "عرض المزيد"}
                  </Text>
                </Pressable>
              ) : null}
              {visible.error ? (
                <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)}
                  style={{ ...button, alignSelf: "flex-start" }}>
                  <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </>
      )}
    </View>
  );
}
