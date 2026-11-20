import { getPublicStore, listPublicOffers } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { type Href, Link, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import StoreProducts from "../catalog/store-products";
import { readStoreBrowseScope, serviceCityLabel } from "../location/serviceability";
import { publicStorefrontPath } from "../sharing/store-share";
import { describeStoreOrderability } from "./orderability";
import { resolvePublicStoreOrigin } from "./public-store-origin";
import { type PublicStoreDetailState, recoverPublicStoreDetail, resolvePublicStoreDetail } from "./store-detail-loader";

type Props = Readonly<{ storeID?: string; fullPage?: boolean }>;

export default function PublicStoreDetail({ storeID, fullPage = false }: Props) {
  const params = useLocalSearchParams<{ id?: string | string[]; city?: string | string[]; q?: string | string[] }>();
  const id = storeID ?? (typeof params.id === "string" ? params.id : "");
  const browse = readStoreBrowseScope(params, "");
  const { theme } = useMobileAppearance();
  const api = resolvePublicStoreOrigin();
  // Route q describes the Store directory, not an Offer search within this Store.
  const [search, setSearch] = React.useState({ storeId: id, draft: "", query: "" });
  const query = search.storeId === id ? search.query : "";
  const draft = search.storeId === id ? search.draft : "";
  const scope = JSON.stringify([id, query]);
  React.useEffect(() => { setSearch({ storeId: id, draft: "", query: "" }); }, [id]);
  const [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<PublicStoreDetailState>({ scope: "", loading: true, offers: [] });
  const revision = React.useRef(0);
  const pending = React.useRef<AbortController | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A retry intentionally reloads this Store from DSH.
  React.useEffect(() => {
    const current = ++revision.current;
    const abort = new AbortController();
    pending.current?.abort();
    pending.current = abort;
    setState({ scope, loading: true, offers: [] });
    resolvePublicStoreDetail(
      getPublicStore(api, id, abort.signal),
      listPublicOffers(api, id, { query, signal: abort.signal, limit: 20 }),
    ).then(({ store, offers, nextCursor, offersError }) => {
      if (!abort.signal.aborted && revision.current === current)
        setState({ scope, loading: false, store, offers, cursor: nextCursor, offersError });
    }).catch((error: unknown) => {
        if (!abort.signal.aborted && revision.current === current)
          setState({ scope, loading: false, offers: [], error: error instanceof Error ? error.message : "UNKNOWN" });
      });
    return () => { abort.abort(); revision.current++; };
  }, [api, id, query, scope, retry]);
  const visible: PublicStoreDetailState = state.scope === scope ? state : { scope, loading: true, offers: [] };
  const textStyle = { color: theme.color };
  const availability = visible.store ? describeStoreOrderability(visible.store) : undefined;
  const more = async () => {
    if (!visible.cursor || visible.more) return;
    const current = revision.current;
    const abort = new AbortController();
    pending.current?.abort();
    pending.current = abort;
    setState((v) => ({ ...v, more: true, offersError: undefined }));
    try {
      const page = await listPublicOffers(api, id, { query, cursor: visible.cursor, limit: 20, signal: abort.signal });
      if (!abort.signal.aborted && revision.current === current)
        setState((v) => v.scope !== scope ? v : { ...v, more: false, offers: [...v.offers, ...page.items], cursor: page.nextCursor, offersError: undefined });
    } catch (error) {
      if (!abort.signal.aborted && revision.current === current)
        setState((v) => v.scope !== scope ? v : recoverPublicStoreDetail(v, error));
    }
  };
  const submitSearch = () => {
    const next = draft.trim();
    setSearch({ storeId: id, draft, query: next });
    if (next === query) setRetry(value => value + 1);
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 18, maxWidth: fullPage ? 1200 : 800, width: "100%", alignSelf: "center", gap: 14 }}>
        <Link href={browse.city ? { pathname: "/stores", params: browse } : "/stores"}
          style={{ color: theme.interactiveText }}>العودة للمتاجر</Link>
        {!visible.error ? <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <TextInput testID="offers-search" accessibilityLabel="البحث في عروض المتجر" placeholder="ابحث في عروض هذا المتجر"
            placeholderTextColor={theme.colorSecondary} value={draft} returnKeyType="search" maxLength={160}
            onChangeText={value => setSearch({ storeId: id, draft: Array.from(value).slice(0, 80).join(""), query })}
            onSubmitEditing={submitSearch}
            style={{ ...textStyle, flexGrow: 1, minWidth: 160, minHeight: 44, padding: 10,
              borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }} />
          <Pressable accessibilityRole="button" accessibilityLabel="تنفيذ البحث في عروض المتجر" onPress={submitSearch}
            style={{ minHeight: 44, padding: 12, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }}>
            <Text style={{ color: theme.interactiveText }}>بحث</Text>
          </Pressable>
          {draft || query ? <Pressable accessibilityRole="button" accessibilityLabel="مسح البحث في عروض المتجر"
            onPress={() => setSearch({ storeId: id, draft: "", query: "" })}
            style={{ minHeight: 44, padding: 12, justifyContent: "center" }}>
            <Text style={{ color: theme.interactiveText }}>مسح البحث</Text>
          </Pressable> : null}
        </View> : null}
        {visible.loading ? <ActivityIndicator accessibilityLabel="جارٍ تحميل المتجر" color={theme.actionBackground} /> : null}
        {visible.store ? <>
          <Text accessibilityRole="header" testID="store-title" style={{ ...textStyle, fontSize: 26, fontWeight: "700" }}>{visible.store.name}</Text>
          {!fullPage ? (
            <Link href={publicStorefrontPath(id) as Href} style={{ color: theme.interactiveText }}>
              عرض موقع المتجر الكامل
            </Link>
          ) : null}
          <Text style={{ ...textStyle, color: theme.colorSecondary }}>المدينة: {serviceCityLabel(visible.store.cityId)}</Text>
          <Text testID="store-orderability-status" style={{ ...textStyle, color: theme.warningText }}>{availability?.headline}</Text>
          <Text style={{ ...textStyle, color: theme.colorSecondary }}>{availability?.detail}</Text>
          <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 21, fontWeight: "600" }}>العروض المتاحة</Text>
          {visible.offers.length === 0 && !visible.offersError
            ? <Text testID="offers-empty" style={textStyle}>{query ? "لا توجد عروض مطابقة للبحث في هذا المتجر." : "لا توجد عروض متاحة الآن."}</Text> : null}
          {visible.offersError ? <View style={{ gap: 8 }}>
            <Text testID="offers-error" accessibilityRole="alert" style={{ ...textStyle, color: theme.dangerText }}>
              {visible.offersError === "STALE_CURSOR" || visible.offersError === "INVALID_CURSOR"
                ? "تغيّرت عروض المتجر. أعد تحميلها لعرض الأسعار الحالية."
                : "تعذّر تحميل بعض العروض. بيانات المتجر لا تزال متاحة."}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="إعادة تحميل عروض المتجر"
              onPress={() => visible.cursor ? more() : setRetry((v) => v + 1)}
              style={{ padding: 14, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }}>
              <Text style={{ color: theme.interactiveText, textAlign: "center" }}>إعادة تحميل العروض</Text>
            </Pressable>
          </View> : null}
          <StoreProducts offers={visible.offers} />
          {visible.cursor && !visible.offersError ? <Pressable accessibilityRole="button" accessibilityLabel="عرض المزيد من عروض المتجر" onPress={more} disabled={visible.more}
            style={{ padding: 14, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }}>
            <Text style={{ color: theme.interactiveText, textAlign: "center" }}>{visible.more ? "جارٍ التحميل" : "عرض المزيد"}</Text>
          </Pressable> : null}
        </> : null}
        {visible.error ? <>
          <Text testID="store-error" accessibilityRole="alert" style={{ ...textStyle, color: theme.dangerText }}>
            {visible.error === "NOT_FOUND" ? "المتجر غير منشور أو غير متاح." : "تعذّر التحقق من بيانات المتجر. حاول مجددًا."}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setRetry((v) => v + 1)}
            style={{ padding: 14, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }}>
            <Text style={{ color: theme.interactiveText, textAlign: "center" }}>إعادة المحاولة</Text>
          </Pressable>
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
