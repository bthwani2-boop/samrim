import { getPublicStore, listPublicOffers } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { type Href, Link, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import StoreProducts from "../catalog/store-products";
import { readStoreBrowseScope, serviceCityLabel } from "../location/serviceability";
import { publicStorefrontPath } from "../sharing/store-share";
import { describeStoreOrderability } from "./orderability";
import { type PublicStoreDetailState, recoverPublicStoreDetail, resolvePublicStoreDetail } from "./store-detail-loader";

const API = process.env.EXPO_PUBLIC_DSH_API_URL ?? "";
type Props = Readonly<{ storeID?: string; fullPage?: boolean }>;

export default function PublicStoreDetail({ storeID, fullPage = false }: Props) {
  const params = useLocalSearchParams<{ id?: string | string[]; city?: string | string[]; q?: string | string[] }>();
  const id = storeID ?? (typeof params.id === "string" ? params.id : "");
  const browse = readStoreBrowseScope(params, "");
  const { theme } = useMobileAppearance();
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
    setState({ scope: id, loading: true, offers: [] });
    resolvePublicStoreDetail(
      getPublicStore(API, id, abort.signal),
      listPublicOffers(API, id, { signal: abort.signal, limit: 20 }),
    ).then(({ store, offers, nextCursor, offersError }) => {
      if (!abort.signal.aborted && revision.current === current)
        setState({ scope: id, loading: false, store, offers, cursor: nextCursor, offersError });
    }).catch((error: unknown) => {
        if (!abort.signal.aborted && revision.current === current)
          setState({ scope: id, loading: false, offers: [], error: error instanceof Error ? error.message : "UNKNOWN" });
      });
    return () => { abort.abort(); revision.current++; };
  }, [id, retry]);
  const visible: PublicStoreDetailState = state.scope === id ? state : { scope: id, loading: true, offers: [] };
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
      const page = await listPublicOffers(API, id, { cursor: visible.cursor, limit: 20, signal: abort.signal });
      if (!abort.signal.aborted && revision.current === current)
        setState((v) => v.scope !== id ? v : { ...v, more: false, offers: [...v.offers, ...page.items], cursor: page.nextCursor, offersError: undefined });
    } catch (error) {
      if (!abort.signal.aborted && revision.current === current)
        setState((v) => v.scope !== id ? v : recoverPublicStoreDetail(v, error));
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 18, maxWidth: fullPage ? 1200 : 800, width: "100%", alignSelf: "center", gap: 14 }}>
        <Link href={browse.city ? { pathname: "/stores", params: browse } : "/stores"}
          style={{ color: theme.interactiveText }}>العودة للمتاجر</Link>
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
            ? <Text testID="offers-empty" style={textStyle}>لا توجد عروض متاحة الآن.</Text> : null}
          {visible.offersError ? <View style={{ gap: 8 }}>
            <Text testID="offers-error" accessibilityRole="alert" style={{ ...textStyle, color: theme.dangerText }}>
              {visible.offersError === "STALE_CURSOR"
                ? "تغيّرت عروض المتجر. أعد تحميلها لعرض الأسعار الحالية."
                : "تعذّر تحميل بعض العروض. بيانات المتجر لا تزال متاحة."}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="إعادة تحميل عروض المتجر"
              onPress={() => visible.cursor && visible.offersError !== "STALE_CURSOR" ? void more() : setRetry((v) => v + 1)}
              style={{ padding: 14, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }}>
              <Text style={{ color: theme.interactiveText, textAlign: "center" }}>إعادة تحميل العروض</Text>
            </Pressable>
          </View> : null}
          <StoreProducts offers={visible.offers} />
          {visible.cursor && !visible.offersError ? <Pressable accessibilityRole="button" onPress={more} disabled={visible.more}
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
