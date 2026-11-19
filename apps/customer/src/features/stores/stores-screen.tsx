import { listPublicStores, type PublicPage, type PublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ServiceCityScope from "../location/service-city-scope";
import { readStoreBrowseScope, STORE_SEARCH_LIMIT, serviceCityLabel } from "../location/serviceability";
import { describeStoreOrderability } from "./orderability";
import { resolvePublicStoreOrigin } from "./public-store-origin";

const INITIAL_CITY = process.env.EXPO_PUBLIC_DSH_CITY_ID ?? "sanaa";
type PageState = { scope: string; loading: boolean; loadingMore: boolean; items: PublicStore[]; cursor?: string | undefined; error?: string | undefined };
function requiresFreshPage(code?: string) {
  return code === "STALE_CURSOR" || code === "INVALID_CURSOR";
}

function message(code?: string) {
  if (requiresFreshPage(code)) return "تغيّرت البيانات. أعد تحميل المتاجر.";
  if (code === "DSH_ENDPOINT_NOT_CONFIGURED") return "خدمة المتاجر غير متاحة حاليًا.";
  if (code === "INVALID_SEARCH") return "عبارة البحث غير صالحة. استخدم ٨٠ حرفًا أو أقل.";
  return "تعذّر تحميل المتاجر. تحقّق من الاتصال وحاول مجددًا.";
}
type Props = Readonly<{ variant?: "home" | "directory" }>;

export default function PublicStoresScreen({ variant = "directory" }: Props) {
  const { theme } = useMobileAppearance();
  const api = resolvePublicStoreOrigin();
  const params = useLocalSearchParams<{ city?: string | string[]; q?: string | string[] }>();
  const initial = readStoreBrowseScope(params, INITIAL_CITY);
  const [draftCity, setDraftCity] = React.useState(initial.city);
  const [cityId, setCityId] = React.useState(initial.city);
  const [showCityPicker, setShowCityPicker] = React.useState(false);
  const [showSearch, setShowSearch] = React.useState(variant === "directory" || Boolean(initial.q));
  const [draftQuery, setDraftQuery] = React.useState(initial.q);
  const [query, setQuery] = React.useState(initial.q);
  const scope = JSON.stringify([cityId, query]);
  const [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<PageState>({ scope: "", loading: true, loadingMore: false, items: [] });
  const generation = React.useRef(0);
  const pageAbort = React.useRef<AbortController | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A retry intentionally reloads the same city from DSH.
  React.useEffect(() => {
    const current = ++generation.current;
    const abort = new AbortController();
    pageAbort.current?.abort();
    pageAbort.current = abort;
    setState({ scope, loading: true, loadingMore: false, items: [] });
    listPublicStores(api, cityId, { query, limit: 20, signal: abort.signal })
      .then((page) => {
        if (!abort.signal.aborted && generation.current === current)
          setState({ scope, loading: false, loadingMore: false, items: page.items, cursor: page.nextCursor });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted && generation.current === current)
          setState({ scope, loading: false, loadingMore: false, items: [], error: error instanceof Error ? error.message : "UNKNOWN" });
      });
    return () => { abort.abort(); generation.current++; };
  }, [api, cityId, query, scope, retry]);
  const visible: PageState = state.scope === scope ? state : { scope, loading: true, loadingMore: false, items: [] };
  const loadMore = async () => {
    if (!visible.cursor || visible.loadingMore || visible.loading) return;
    const scopedCity = cityId;
    const current = generation.current;
    const abort = new AbortController();
    pageAbort.current?.abort();
    pageAbort.current = abort;
    setState((old) => ({ ...old, loadingMore: true, error: undefined }));
    try {
      const page: PublicPage<PublicStore> = await listPublicStores(api, scopedCity, { query, cursor: visible.cursor, limit: 20, signal: abort.signal });
      if (generation.current !== current || abort.signal.aborted) return;
      setState((old) => old.scope !== scope ? old : {
        ...old, loadingMore: false, items: [...old.items, ...page.items], cursor: page.nextCursor,
      });
    } catch (error) {
      if (generation.current !== current || abort.signal.aborted) return;
      const code = error instanceof Error ? error.message : "UNKNOWN";
      setState((old) => {
        if (old.scope !== scope) return old;
        // DSH has rejected the list snapshot. Reload before showing its cards again.
        if (requiresFreshPage(code)) return { scope, loading: false, loadingMore: false, items: [], error: code };
        return { ...old, loadingMore: false, error: code };
      });
    }
  };
  const textStyle = { color: theme.color };
  const buttonStyle = { paddingHorizontal: 12, paddingVertical: 8, minHeight: 44,
    borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor } as const;
  const headerAction = { ...buttonStyle, justifyContent: "center",
    alignItems: "center", backgroundColor: theme.surface } as const;
  const browseParams = { city: cityId, ...(query ? { q: query } : {}) };
  const submitSearch = () => setQuery(draftQuery.trim());
  return (
    <SafeAreaView
      edges={variant === "home" ? ["top", "left", "right"] : ["top", "bottom", "left", "right"]}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <View style={{ borderBottomWidth: 1, borderBottomColor: theme.borderColor, backgroundColor: theme.surface }}>
        <View style={{ width: "100%", maxWidth: 1120, alignSelf: "center", paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 22, fontWeight: "800" }}>
              {variant === "home" ? "بثواني" : "متاجر بثواني"}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="البحث عن متجر"
                accessibilityState={{ expanded: showSearch }} style={headerAction}
                onPress={() => { setShowSearch(value => !value); setShowCityPicker(false); }}>
                <Text style={{ color: theme.interactiveText, fontWeight: "700" }}>بحث</Text>
              </Pressable>
              <Link href="/notifications" asChild>
                <Pressable accessibilityRole="link" style={headerAction}>
                  <Text style={{ color: theme.interactiveText, fontWeight: "700" }}>الإشعارات</Text>
                </Pressable>
              </Link>
            </View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCityPicker }}
              accessibilityLabel={`تغيير مدينة التسوّق، ${serviceCityLabel(cityId)}`}
              onPress={() => { setDraftCity(cityId); setShowCityPicker(value => !value); setShowSearch(false); }}
              style={{ minHeight: 44, justifyContent: "center" }}>
              <Text style={{ color: theme.interactiveText, fontWeight: "600" }}>
                مدينة التسوّق: {serviceCityLabel(cityId)}
              </Text>
            </Pressable>
            {variant === "directory" ? (
              <Link href={{ pathname: "/", params: browseParams }} style={{ color: theme.interactiveText }}>الرئيسية</Link>
            ) : null}
            {query ? <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}
              onPress={() => { setDraftQuery(""); setQuery(""); }}>
              <Text style={{ color: theme.interactiveText }}>مسح البحث</Text>
            </Pressable> : null}
          </View>
          {showCityPicker ? <ServiceCityScope draftCity={draftCity} onDraftChange={setDraftCity}
            onApply={nextCity => { setCityId(nextCity); setShowCityPicker(false); }} /> : null}
          {showSearch ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput testID="stores-search" accessibilityLabel="البحث باسم المتجر" placeholder="ابحث باسم المتجر"
                placeholderTextColor={theme.colorSecondary} value={draftQuery}
                autoFocus={variant === "home" && !initial.q}
                onChangeText={value => setDraftQuery(Array.from(value).slice(0, STORE_SEARCH_LIMIT).join(""))}
                returnKeyType="search" onSubmitEditing={submitSearch}
                style={{ ...buttonStyle, flex: 1, minWidth: 0, color: theme.color }} />
              <Pressable accessibilityRole="button" onPress={submitSearch}
                style={{ ...buttonStyle, justifyContent: "center", backgroundColor: theme.actionBackground }}>
                <Text style={{ color: theme.onAction, fontWeight: "700" }}>عرض النتائج</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{
        padding: 16, gap: 16, maxWidth: 1120, width: "100%", alignSelf: "center",
      }}>
        {variant === "home" ? (
          <Link href={{ pathname: "/stores", params: browseParams }} asChild>
            <Pressable accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center" }}>
              <Text style={{ color: theme.interactiveText, fontSize: 16, fontWeight: "700" }}>جميع المتاجر</Text>
            </Pressable>
          </Link>
        ) : null}
        {visible.loading ? <ActivityIndicator accessibilityLabel="جارٍ تحميل المتاجر" color={theme.actionBackground} /> : null}
        {!visible.loading && visible.items.length === 0 && !visible.error
          ? <Text testID="stores-empty" style={textStyle}>{query ? "لا توجد متاجر مطابقة للبحث في هذه المدينة." : "لا توجد متاجر منشورة لهذه المدينة حاليًا."}</Text> : null}
        {visible.items.map((store) => {
          const availability = describeStoreOrderability(store);
          return (
            <Link key={store.id} href={{ pathname: "/store/[id]", params: { ...browseParams, id: store.id } }} asChild>
              <Pressable testID={`store-${store.id}`} accessibilityRole="link"
                accessibilityLabel={`عرض المتجر ${store.name}`}
                style={{ backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1,
                  borderRadius: 12, padding: 14, gap: 6 }}>
                <Text style={{ ...textStyle, fontSize: 19, fontWeight: "600" }}>{store.name}</Text>
                <Text testID={`availability-status-${store.id}`} style={{ ...textStyle, color: theme.warningText }}>{availability.headline}</Text>
                {store.orderabilityStatus === "OPEN_FOR_ORDERS" ? (
                  <Text style={{ ...textStyle, color: theme.colorSecondary }}>{availability.detail}</Text>
                ) : null}
              </Pressable>
            </Link>
          );
        })}
        {visible.error ? <View style={{ gap: 8, backgroundColor: theme.surface, borderRadius: 12, padding: 16 }}>
          <Text testID="stores-error" accessibilityRole="alert" style={{ ...textStyle, color: theme.dangerText }}>{message(visible.error)}</Text>
          {visible.error !== "DSH_ENDPOINT_NOT_CONFIGURED" ? <Pressable accessibilityRole="button" onPress={() => setRetry((v) => v + 1)} style={{ ...buttonStyle, alignSelf: "flex-start" }}>
            <Text style={{ color: theme.interactiveText, textAlign: "center" }}>إعادة المحاولة</Text>
          </Pressable> : null}
        </View> : null}
        {visible.cursor && !visible.error ? <Pressable accessibilityRole="button" disabled={visible.loadingMore} onPress={loadMore} style={buttonStyle}>
          <Text style={{ color: theme.interactiveText, textAlign: "center" }}>{visible.loadingMore ? "جارٍ التحميل" : "عرض المزيد"}</Text>
        </Pressable> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
