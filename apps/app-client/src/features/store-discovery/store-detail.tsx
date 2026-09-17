import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

import { direction, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import { formatMoney, type PublicCatalogResponse, type PublicStoreView } from "@bthwani/dsh";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { readPublicStoreCatalog, readPublishedStore } from "./store-discovery-client";

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; store: PublicStoreView; catalog: PublicCatalogResponse }
  | { kind: "error" };

export default function ClientStoreDetail({ storeId }: { storeId: string }) {
  const router = useRouter();
  const { selectedCityID } = useServiceCityScope();
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DetailState>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!storeId.trim() || !selectedCityID) {
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const [store, catalog] = await Promise.all([readPublishedStore(storeId, selectedCityID), readPublicStoreCatalog(storeId, selectedCityID)]);
      setState({ kind: "ready", store, catalog });
    } catch {
      setState({ kind: "error" });
    }
  }, [selectedCityID, storeId]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "loading") {
    return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ فتح المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة كتالوج المتجر…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر قراءة المتجر</Text><Text style={styles.muted}>قد لا يكون المتجر متاحًا في مدينة الخدمة الحالية.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>إعادة المحاولة</Text></Pressable><Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>العودة</Text></Pressable></View>;
  }

  const sectionOfferIds = new Set(state.catalog.sections.flatMap((section) => section.offerIds));
  const renderOffer = (offer: PublicCatalogResponse["offers"][number]) => (
    <View key={offer.offerId} style={styles.item}>
      <Text style={styles.itemTitle}>{offer.productName}</Text>
      <Text style={styles.muted}>{formatMoney(offer.priceMinor, offer.currency)} · {offer.measurementKind === "DISCRETE" ? "بالقطعة" : offer.baseUnit === "GRAM" ? "بالغرام" : "بالمليلتر"}</Text>
      <Text style={styles.muted}>متاح للطلب</Text>
    </View>
  );

  return (
    <View style={styles.container} accessibilityLabel={`كتالوج ${state.store.name}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى المتاجر" onPress={() => router.back()}><Text style={styles.back}>‹ المتاجر المتاحة</Text></Pressable>
      <Text style={styles.eyebrow}>كتالوج المتجر</Text>
      <Text style={styles.title}>{state.store.name}</Text>
      <Text style={styles.muted}>مدينة الخدمة: {state.store.serviceCity.displayNameAr}</Text>
      <Text style={styles.sectionTitle}>المنتجات المتاحة</Text>
      {state.catalog.sections.map((section) => (
        <View key={section.id} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.nameAr}</Text>
          {section.offerIds.map((offerId) => state.catalog.offers.find((offer) => offer.offerId === offerId)).filter((offer): offer is PublicCatalogResponse["offers"][number] => Boolean(offer)).map(renderOffer)}
        </View>
      ))}
      {state.catalog.offers.filter((offer) => !sectionOfferIds.has(offer.offerId)).map(renderOffer)}
      {state.catalog.offers.length === 0 ? <Text style={styles.muted}>لا توجد منتجات متاحة حاليًا.</Text> : null}
      <View style={styles.cartCta}>
        <Text style={styles.muted}>الخطوة التالية: أضف المنتجات إلى السلة ثم أكد العنوان وإتمام الطلب.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="فتح السلة" onPress={() => router.push(`/cart/${encodeURIComponent(storeId)}` as Href)} style={styles.button}><Text style={styles.buttonText}>فتح السلة</Text></Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, direction: activeDirection, gap: 10, padding: 14, width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: 10, paddingVertical: 28, width: "100%" },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: startTextAlign },
    title: { color: theme.color, fontSize: 20, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
    sectionTitle: { color: theme.color, fontSize: 15, fontWeight: "800", textAlign: startTextAlign },
    section: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, gap: 8, padding: 10 },
    item: { borderColor: theme.borderColor, borderTopWidth: 1, gap: 3, paddingTop: 8 },
    itemTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    back: { color: theme.interactiveText, fontSize: 14, fontWeight: "700", textAlign: startTextAlign },
    cartCta: { backgroundColor: theme.actionSoft, borderRadius: 10, gap: 8, padding: 10 },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
  });
}
