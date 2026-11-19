import { listPublicStores, type PublicPage, type PublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { type Href, Link, router } from "expo-router";
import * as React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ServiceCityScope from "../location/service-city-scope";
import { describeStoreOrderability } from "./orderability";

const API = process.env.EXPO_PUBLIC_DSH_API_URL ?? "";
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
  const [draftCity, setDraftCity] = React.useState(INITIAL_CITY);
  const [cityId, setCityId] = React.useState(INITIAL_CITY);
  const [showCityPicker, setShowCityPicker] = React.useState(false);
  const [draftQuery, setDraftQuery] = React.useState("");
  const [query, setQuery] = React.useState("");
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
    listPublicStores(API, cityId, { query, limit: 20, signal: abort.signal })
      .then((page) => {
        if (!abort.signal.aborted && generation.current === current)
          setState({ scope, loading: false, loadingMore: false, items: page.items, cursor: page.nextCursor });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted && generation.current === current)
          setState({ scope, loading: false, loadingMore: false, items: [], error: error instanceof Error ? error.message : "UNKNOWN" });
      });
    return () => { abort.abort(); generation.current++; };
  }, [cityId, query, scope, retry]);
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
      const page: PublicPage<PublicStore> = await listPublicStores(API, scopedCity, { query, cursor: visible.cursor, limit: 20, signal: abort.signal });
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
  const buttonStyle = { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.borderColor };
  const submitSearch = () => setQuery(draftQuery.trim());
  return (
    <SafeAreaView
      edges={variant === "home" ? ["top", "left", "right"] : ["top", "bottom", "left", "right"]}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 24, gap: 20, maxWidth: 1120, width: "100%", alignSelf: "center" }}>
        {variant === "directory" ? <Link href="/" style={{ color: theme.interactiveText }}>الرئيسية</Link> : null}
        <View style={{ gap: 12, padding: 20, backgroundColor: theme.surface, borderRadius: 18 }}>
          <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 28, fontWeight: "800" }}>
            {variant === "home" ? "تسوّق من متاجر مدينتك" : "متاجر بثواني"}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput testID="stores-search" accessibilityLabel="البحث باسم المتجر" placeholder="ابحث باسم المتجر"
              placeholderTextColor={theme.colorSecondary} value={draftQuery}
              onChangeText={(value) => setDraftQuery(Array.from(value).slice(0, 80).join(""))}
              returnKeyType="search" onSubmitEditing={submitSearch}
              style={{ ...buttonStyle, flex: 1, minWidth: 0, color: theme.color }} />
            <Pressable accessibilityRole="button" onPress={submitSearch}
              style={{ ...buttonStyle, justifyContent: "center", backgroundColor: theme.actionBackground }}>
              <Text style={{ color: theme.onAction, fontWeight: "700" }}>بحث</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCityPicker }}
              onPress={() => setShowCityPicker(value => !value)} style={{ minHeight: 44, justifyContent: "center" }}>
              <Text style={{ color: theme.interactiveText, fontWeight: "600" }}>تغيير مدينة التسوّق</Text>
            </Pressable>
            {query ? <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}
              onPress={() => { setDraftQuery(""); setQuery(""); }}>
              <Text style={{ color: theme.interactiveText }}>مسح البحث</Text>
            </Pressable> : null}
          </View>
          {showCityPicker ? <ServiceCityScope draftCity={draftCity} onDraftChange={setDraftCity}
            onApply={nextCity => { setCityId(nextCity); setShowCityPicker(false); }} /> : null}
        </View>
        {variant === "home" ? (
          <Link href="/stores" asChild>
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
            <Pressable key={store.id} testID={`store-${store.id}`} accessibilityRole="button"
              accessibilityLabel={`عرض المتجر ${store.name}`} onPress={() => router.push((`/store/${encodeURIComponent(store.id)}`) as Href)}
              style={{ backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12, padding: 18, gap: 6 }}>
              <Text style={{ ...textStyle, fontSize: 19, fontWeight: "600" }}>{store.name}</Text>
              <Text testID={`availability-status-${store.id}`} style={{ ...textStyle, color: theme.colorSecondary }}>{availability.headline}</Text>
              <Text style={{ ...textStyle, color: theme.warningText }}>{availability.detail}</Text>
            </Pressable>
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
