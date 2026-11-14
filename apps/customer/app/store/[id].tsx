import { getPublicStore, listPublicOffers, type PublicOffer, type PublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { type Href, Link, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";

const API = process.env.EXPO_PUBLIC_DSH_API_URL ?? "";
type StoreResult = { scope: string; loading: boolean; store?: PublicStore; offers: PublicOffer[]; cursor?: string | undefined; more?: boolean; error?: string | undefined };
export default function PublicStoreDetail() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = typeof idParam === "string" ? idParam : "";
  const { theme } = useMobileAppearance();
  const [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<StoreResult>({ scope: "", loading: true, offers: [] });
  const revision = React.useRef(0);
  const pending = React.useRef<AbortController | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A retry intentionally reloads this Store from DSH.
  React.useEffect(() => {
    const current = ++revision.current;
    const abort = new AbortController();
    pending.current?.abort();
    pending.current = abort;
    setState({ scope: id, loading: true, offers: [] });
    Promise.all([getPublicStore(API, id, abort.signal), listPublicOffers(API, id, { signal: abort.signal, limit: 20 })])
      .then(([store, offers]) => {
        if (!abort.signal.aborted && revision.current === current)
          setState({ scope: id, loading: false, store, offers: offers.items, cursor: offers.nextCursor });
      }).catch((error: unknown) => {
        if (!abort.signal.aborted && revision.current === current)
          setState({ scope: id, loading: false, offers: [], error: error instanceof Error ? error.message : "UNKNOWN" });
      });
    return () => { abort.abort(); revision.current++; };
  }, [id, retry]);
  const visible = state.scope === id ? state : { scope: id, loading: true, offers: [] };
  const textStyle = { color: theme.color };
  const more = async () => {
    if (!visible.cursor || visible.more) return;
    const current = revision.current;
    const abort = new AbortController();
    pending.current?.abort();
    pending.current = abort;
    setState((v) => ({ ...v, more: true }));
    try {
      const page = await listPublicOffers(API, id, { cursor: visible.cursor, limit: 20, signal: abort.signal });
      if (!abort.signal.aborted && revision.current === current)
        setState((v) => v.scope !== id ? v : { ...v, more: false, offers: [...v.offers, ...page.items], cursor: page.nextCursor });
    } catch (error) {
      if (!abort.signal.aborted && revision.current === current)
        setState((v) => v.scope !== id ? v : { ...v, more: false, error: error instanceof Error ? error.message : "UNKNOWN" });
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 18, maxWidth: 800, width: "100%", alignSelf: "center", gap: 14 }}>
        <Link href={"/stores" as Href} style={{ color: theme.interactiveText }}>العودة للمتاجر</Link>
        {visible.loading ? <ActivityIndicator accessibilityLabel="جارٍ تحميل المتجر" color={theme.actionBackground} /> : null}
        {visible.store ? <>
          <Text accessibilityRole="header" testID="store-title" style={{ ...textStyle, fontSize: 26, fontWeight: "700" }}>{visible.store.name}</Text>
          <Text style={{ ...textStyle, color: theme.colorSecondary }}>المدينة: {visible.store.cityId}</Text>
          <Text style={{ ...textStyle, color: theme.warningText }}>{visible.store.orderabilityStatus === "PAUSED" ? "المتجر متوقف مؤقتًا" : "الطلبات غير متاحة حاليًا"}</Text>
          <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 21, fontWeight: "600" }}>العروض المتاحة</Text>
          {visible.offers.length === 0 && !visible.error
            ? <Text testID="offers-empty" style={textStyle}>لا توجد عروض متاحة الآن.</Text> : null}
          {visible.offers.map((offer) => <View key={offer.id} testID={`offer-${offer.id}`}
            style={{ backgroundColor: theme.surface, padding: 16, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 12, gap: 6 }}>
            <Text style={{ ...textStyle, fontWeight: "600", fontSize: 17 }}>{offer.name}</Text>
            <Text style={{ ...textStyle, color: theme.colorSecondary }}>{offer.priceYer.toLocaleString("ar-YE")} ريال يمني</Text>
          </View>)}
          {visible.cursor && !visible.error ? <Pressable accessibilityRole="button" onPress={more} disabled={visible.more}
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
