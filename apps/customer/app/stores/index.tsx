import { listPublicStores, type PublicPage, type PublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { type Href, Link, router } from "expo-router";
import * as React from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";

const API = process.env.EXPO_PUBLIC_DSH_API_URL ?? "";
const INITIAL_CITY = process.env.EXPO_PUBLIC_DSH_CITY_ID ?? "sanaa";
type PageState = { scope: string; loading: boolean; loadingMore: boolean; items: PublicStore[]; cursor?: string | undefined; error?: string | undefined };
function message(code?: string) {
  if (code === "STALE_CURSOR") return "تغيّرت البيانات. أعد تحميل المتاجر.";
  if (code === "DSH_ENDPOINT_NOT_CONFIGURED") return "لم يُضبط عنوان خدمة المتاجر.";
  return "تعذّر تحميل المتاجر. تحقّق من الاتصال وحاول مجددًا.";
}
export default function PublicStoresScreen() {
  const { theme } = useMobileAppearance();
  const [draftCity, setDraftCity] = React.useState(INITIAL_CITY);
  const [cityId, setCityId] = React.useState(INITIAL_CITY);
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
    setState({ scope: cityId, loading: true, loadingMore: false, items: [] });
    listPublicStores(API, cityId, { limit: 20, signal: abort.signal })
      .then((page) => {
        if (!abort.signal.aborted && generation.current === current)
          setState({ scope: cityId, loading: false, loadingMore: false, items: page.items, cursor: page.nextCursor });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted && generation.current === current)
          setState({ scope: cityId, loading: false, loadingMore: false, items: [], error: error instanceof Error ? error.message : "UNKNOWN" });
      });
    return () => { abort.abort(); generation.current++; };
  }, [cityId, retry]);
  const visible: PageState = state.scope === cityId ? state : { scope: cityId, loading: true, loadingMore: false, items: [] };
  const loadMore = async () => {
    if (!visible.cursor || visible.loadingMore || visible.loading) return;
    const scopedCity = cityId;
    const current = generation.current;
    const abort = new AbortController();
    pageAbort.current?.abort();
    pageAbort.current = abort;
    setState((old) => ({ ...old, loadingMore: true, error: undefined }));
    try {
      const page: PublicPage<PublicStore> = await listPublicStores(API, scopedCity, { cursor: visible.cursor, limit: 20, signal: abort.signal });
      if (generation.current !== current || abort.signal.aborted) return;
      setState((old) => old.scope !== scopedCity ? old : {
        ...old, loadingMore: false, items: [...old.items, ...page.items], cursor: page.nextCursor,
      });
    } catch (error) {
      if (generation.current === current && !abort.signal.aborted)
        setState((old) => old.scope !== scopedCity ? old : { ...old, loadingMore: false, error: error instanceof Error ? error.message : "UNKNOWN" });
    }
  };
  const textStyle = { color: theme.color };
  const buttonStyle = { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.borderColor };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, maxWidth: 800, width: "100%", alignSelf: "center" }}>
        {__DEV__ ? <Link href={"/foundation" as Href} style={{ color: theme.interactiveText }}>مختبر الواجهة</Link> : null}
        <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 26, fontWeight: "700" }}>متاجر بثواني</Text>
        <Text style={{ ...textStyle, color: theme.colorSecondary }}>البيانات المنشورة فقط من خدمة المتاجر. عرض المتجر لا يعني إمكانية إتمام الطلب.</Text>
        <Text accessibilityRole="text" style={textStyle}>رمز مدينة الخدمة</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput testID="city-input" accessibilityLabel="رمز مدينة الخدمة" value={draftCity} onChangeText={setDraftCity}
            autoCapitalize="none" returnKeyType="search" onSubmitEditing={() => setCityId(draftCity.trim().toLowerCase())}
            style={{ ...textStyle, flex: 1, padding: 12, borderWidth: 1, borderRadius: 10, borderColor: theme.borderColor }} />
          <Pressable accessibilityRole="button" accessibilityLabel="تغيير مدينة الخدمة"
            style={{ ...buttonStyle, backgroundColor: theme.actionSoft }} onPress={() => setCityId(draftCity.trim().toLowerCase())}>
            <Text style={{ color: theme.interactiveText }}>عرض</Text>
          </Pressable>
        </View>
        {visible.loading ? <ActivityIndicator accessibilityLabel="جارٍ تحميل المتاجر" color={theme.actionBackground} /> : null}
        {!visible.loading && visible.items.length === 0 && !visible.error
          ? <Text testID="stores-empty" style={textStyle}>لا توجد متاجر منشورة لهذه المدينة حاليًا.</Text> : null}
        {visible.items.map((store) => (
          <Pressable key={store.id} testID={`store-${store.id}`} accessibilityRole="button"
            accessibilityLabel={`عرض المتجر ${store.name}`} onPress={() => router.push((`/store/${encodeURIComponent(store.id)}`) as Href)}
            style={{ backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12, padding: 18, gap: 6 }}>
            <Text style={{ ...textStyle, fontSize: 19, fontWeight: "600" }}>{store.name}</Text>
            <Text style={{ ...textStyle, color: theme.colorSecondary }}>{store.orderabilityStatus === "PAUSED" ? "متوقف مؤقتًا" : store.orderabilityStatus === "CLOSED_BY_SCHEDULE" ? "مغلق" : "متجر منشور"}</Text>
            <Text style={{ ...textStyle, color: theme.warningText }}>الطلب غير متاح حتى تأكيد الجاهزية</Text>
          </Pressable>
        ))}
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
