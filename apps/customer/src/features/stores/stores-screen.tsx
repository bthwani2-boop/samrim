import { listPublicStores, type PublicPage, type PublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { type Href, Link, router } from "expo-router";
import * as React from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import ServiceCityScope from "../location/service-city-scope";
import { describeStoreOrderability } from "./orderability";

const API = process.env.EXPO_PUBLIC_DSH_API_URL ?? "";
const INITIAL_CITY = process.env.EXPO_PUBLIC_DSH_CITY_ID ?? "sanaa";
type PageState = { scope: string; loading: boolean; loadingMore: boolean; items: PublicStore[]; cursor?: string | undefined; error?: string | undefined };
function message(code?: string) {
  if (code === "STALE_CURSOR") return "تغيّرت البيانات. أعد تحميل المتاجر.";
  if (code === "DSH_ENDPOINT_NOT_CONFIGURED") return "لم يُضبط عنوان خدمة المتاجر.";
  if (code === "INVALID_SEARCH") return "عبارة البحث غير صالحة. استخدم ٨٠ حرفًا أو أقل.";
  return "تعذّر تحميل المتاجر. تحقّق من الاتصال وحاول مجددًا.";
}
type Props = Readonly<{ variant?: "home" | "directory" }>;

export default function PublicStoresScreen({ variant = "directory" }: Props) {
  const { theme } = useMobileAppearance();
  const [draftCity, setDraftCity] = React.useState(INITIAL_CITY);
  const [cityId, setCityId] = React.useState(INITIAL_CITY);
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
      if (generation.current === current && !abort.signal.aborted)
        setState((old) => old.scope !== scope ? old : { ...old, loadingMore: false, error: error instanceof Error ? error.message : "UNKNOWN" });
    }
  };
  const textStyle = { color: theme.color };
  const buttonStyle = { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.borderColor };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, maxWidth: 800, width: "100%", alignSelf: "center" }}>
        {__DEV__ ? <Link href={"/foundation" as Href} style={{ color: theme.interactiveText }}>مختبر الواجهة</Link> : null}
        <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 26, fontWeight: "700" }}>{variant === "home" ? "بثواني — الرئيسية" : "متاجر بثواني"}</Text>
        {variant === "home" ? (
          <Link href="/stores" style={{ color: theme.interactiveText }}>جميع المتاجر</Link>
        ) : <Link href="/" style={{ color: theme.interactiveText }}>الرئيسية</Link>}
        <Text style={{ ...textStyle, color: theme.colorSecondary }}>البيانات المنشورة فقط من خدمة المتاجر. عرض المتجر لا يعني إمكانية إتمام الطلب.</Text>
        <ServiceCityScope draftCity={draftCity} onDraftChange={setDraftCity} onApply={setCityId} />
        <View style={{ gap: 8 }}>
          <TextInput testID="stores-search" accessibilityLabel="البحث باسم المتجر" placeholder="ابحث باسم المتجر"
            placeholderTextColor={theme.colorSecondary} value={draftQuery}
            onChangeText={(value) => setDraftQuery(Array.from(value).slice(0, 80).join(""))}
            returnKeyType="search" onSubmitEditing={() => setQuery(draftQuery.trim())}
            style={{ ...buttonStyle, color: theme.color }} />
          <Pressable accessibilityRole="button" onPress={() => setQuery(draftQuery.trim())} style={buttonStyle}>
            <Text style={{ color: theme.interactiveText, textAlign: "center" }}>بحث</Text>
          </Pressable>
          {query ? <Pressable accessibilityRole="button" onPress={() => { setDraftQuery(""); setQuery(""); }}>
            <Text style={{ color: theme.interactiveText }}>مسح البحث</Text>
          </Pressable> : null}
        </View>
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
        {visible.error ? <View style={{ gap: 8 }}>
          <Text testID="stores-error" accessibilityRole="alert" style={{ ...textStyle, color: theme.dangerText }}>{message(visible.error)}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetry((v) => v + 1)} style={buttonStyle}>
            <Text style={{ color: theme.interactiveText, textAlign: "center" }}>إعادة المحاولة</Text>
          </Pressable>
        </View> : null}
        {visible.cursor && !visible.error ? <Pressable accessibilityRole="button" disabled={visible.loadingMore} onPress={loadMore} style={buttonStyle}>
          <Text style={{ color: theme.interactiveText, textAlign: "center" }}>{visible.loadingMore ? "جارٍ التحميل" : "عرض المزيد"}</Text>
        </Pressable> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
