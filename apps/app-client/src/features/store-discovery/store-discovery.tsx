import { direction, resolveRowDirection, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import { formatMoney, type DeliveryAddress, type PublicCatalogResponse, type PublicStoreView, type ServiceabilityResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { CartCheckout } from "../cart-checkout/cart-checkout";
import { evaluateStoreServiceability, listOwnDeliveryAddresses, listPublishedStores, readPublicStoreCatalog, readPublishedStore } from "./store-discovery-client";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PublicStoreView> }
  | { kind: "empty" }
  | { kind: "error" };

type AddressState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; addresses: ReadonlyArray<DeliveryAddress> }
  | { kind: "unauthenticated" }
  | { kind: "error" };

type ServiceabilityState =
  | { kind: "idle" }
  | { kind: "loading"; addressID: string }
  | { kind: "ready"; addressID: string; result: ServiceabilityResponse }
  | { kind: "error"; addressID: string };

function serviceabilityMessage(status: ServiceabilityResponse["status"]): string {
  if (status === "SERVICEABLE") return "العنوان متاح للتوصيل من هذا المتجر.";
  if (status === "UNSERVICEABLE") return "العنوان خارج نطاق مدينة المتجر المختارة.";
  return "تعذر تأكيد أهلية العنوان الآن. أعد المحاولة لاحقًا.";
}

export default function StoreDiscovery({ isAuthenticated = true }: { isAuthenticated?: boolean }) {
  const { cities, selectedCityID } = useServiceCityScope();
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });
  const [selected, setSelected] = useState<PublicStoreView | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalogResponse | null>(null);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [addressState, setAddressState] = useState<AddressState>({ kind: "idle" });
  const [serviceabilityState, setServiceabilityState] = useState<ServiceabilityState>({ kind: "idle" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setSelected(null);
    setCatalog(null);
    setCatalogLoadingMore(false);
    setDetailState("idle");
    setAddressState({ kind: "idle" });
    setServiceabilityState({ kind: "idle" });
    try {
      if (!selectedCityID) return;
      const stores = await listPublishedStores(selectedCityID);
      setState(stores.length ? { kind: "ready", stores } : { kind: "empty" });
    } catch {
      setState({ kind: "error" });
    }
  }, [selectedCityID]);

  useEffect(() => { void load(); }, [load]);

  async function openStore(store: PublicStoreView) {
    setSelected(null);
    setCatalog(null);
    setDetailState("loading");
    setAddressState(isAuthenticated ? { kind: "loading" } : { kind: "unauthenticated" });
    setServiceabilityState({ kind: "idle" });
    try {
      if (!selectedCityID) return;
      const [storeDetails, catalogDetails] = await Promise.all([readPublishedStore(store.id, selectedCityID), readPublicStoreCatalog(store.id, selectedCityID)]);
      setSelected(storeDetails);
      setCatalog(catalogDetails);
      setDetailState("ready");
    } catch {
      setAddressState({ kind: "idle" });
      setDetailState("error");
      return;
    }
    if (!isAuthenticated) return;
    try {
      const result = await listOwnDeliveryAddresses();
      setAddressState({ kind: "ready", addresses: result.addresses });
    } catch {
      setAddressState({ kind: "error" });
    }
  }

  async function loadMoreCatalog() {
    if (!selected || !selectedCityID || !catalog?.nextCursor || catalogLoadingMore) return;
    setCatalogLoadingMore(true);
    try {
      const next = await readPublicStoreCatalog(selected.id, selectedCityID, "", "", 20, catalog.nextCursor);
      setCatalog((current) => current ? { ...current, offers: [...current.offers, ...next.offers.filter((offer) => !current.offers.some((existing) => existing.offerId === offer.offerId))], sections: [...current.sections, ...next.sections.filter((section) => !current.sections.some((existing) => existing.id === section.id))], nextCursor: next.nextCursor } : next);
    } catch {
      setDetailState("error");
    } finally {
      setCatalogLoadingMore(false);
    }
  }

  async function loadAddresses() {
    if (!isAuthenticated) return;
    setAddressState({ kind: "loading" });
    try {
      const result = await listOwnDeliveryAddresses();
      setAddressState({ kind: "ready", addresses: result.addresses });
    } catch {
      setAddressState({ kind: "error" });
    }
  }

  async function evaluateAddress(addressID: string) {
    if (!selected) return;
    setServiceabilityState({ kind: "loading", addressID });
    try {
      const result = await evaluateStoreServiceability(selected.id, addressID);
      setServiceabilityState({ kind: "ready", addressID, result });
    } catch {
      setServiceabilityState({ kind: "error", addressID });
    }
  }

  if (state.kind === "loading") {
    return <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المتاجر المنشورة…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر اكتشاف المتاجر</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>إعادة المحاولة</Text></Pressable></View>;
  }
  if (state.kind === "empty") {
    return <View style={styles.state}><Text style={styles.title}>لا توجد متاجر متاحة</Text><Text style={styles.muted}>ستظهر المتاجر هنا عندما تصبح متاحة للطلب.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>تحديث</Text></Pressable></View>;
  }
  if (state.kind === "ready" && !selected) {
    return <View style={styles.container}><Text style={styles.eyebrow}>اكتشاف العميل</Text><Text style={styles.title}>المتاجر المتاحة</Text><Text style={styles.muted}>اختر متجرًا لعرض المنتجات وخيارات التوصيل المتاحة في مدينتك.</Text><View style={styles.list}>{state.stores.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`فتح متجر ${item.name}`} onPress={() => void openStore(item)} style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardMeta}>{item.serviceCity.displayNameAr} · متاح للطلب</Text></Pressable>)}</View></View>;
  }
  if (detailState === "loading") {
    return <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ فتح تفاصيل المتجر…</Text></View>;
  }
  if (detailState === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر قراءة تفاصيل المتجر</Text><Pressable accessibilityRole="button" onPress={() => setDetailState("idle")} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>العودة إلى المتاجر</Text></Pressable></View>;
  }
  if (selected) {
    const serviceableAddressId = serviceabilityState.kind === "ready" && serviceabilityState.result.status === "SERVICEABLE" ? serviceabilityState.addressID : undefined;
    const sectionOfferIDs = new Set(catalog?.sections.flatMap((section) => section.offerIds) ?? []);
    const renderOffer = (offer: PublicCatalogResponse["offers"][number]) => <View key={offer.offerId} style={styles.item}><Text style={styles.meta}>{offer.productName}</Text><Text style={styles.meta}>{formatMoney(offer.priceMinor, offer.currency)} · {offer.measurementKind === "DISCRETE" ? "بالقطعة" : offer.baseUnit === "GRAM" ? "بالغرام" : "بالمليلتر"}</Text><Text style={styles.muted}>متاح للطلب</Text></View>;
    return (
      <View style={styles.detail}>
        <Pressable accessibilityRole="button" onPress={() => { setSelected(null); setCatalog(null); setDetailState("idle"); setAddressState({ kind: "idle" }); setServiceabilityState({ kind: "idle" }); }}>
          <Text style={styles.back}>‹ المتاجر المتاحة</Text>
        </Pressable>
        <Text style={styles.title}>{selected.name}</Text>
        <Text style={styles.muted}>متجر متاح للاكتشاف والطلب</Text>
        <Text style={styles.meta}>مدينة الخدمة: {selected.serviceCity.displayNameAr}</Text>
        <Text style={styles.sectionTitle}>المنتجات المتاحة</Text>
        {catalog?.sections.map((section) => <View key={section.id} style={styles.catalogSection}><Text style={styles.sectionTitle}>{section.nameAr}</Text>{section.offerIds.map((offerID) => catalog.offers.find((offer) => offer.offerId === offerID)).filter((offer): offer is PublicCatalogResponse["offers"][number] => Boolean(offer)).map(renderOffer)}</View>)}
        {catalog?.offers.filter((offer) => !sectionOfferIDs.has(offer.offerId)).map(renderOffer)}
        {catalog?.offers.length === 0 ? <Text style={styles.muted}>لا توجد منتجات متاحة حاليًا.</Text> : null}
        {catalog?.nextCursor ? <Pressable accessibilityRole="button" accessibilityState={{ busy: catalogLoadingMore, disabled: catalogLoadingMore }} disabled={catalogLoadingMore} onPress={() => void loadMoreCatalog()} style={[styles.secondaryButton, catalogLoadingMore && styles.disabledButton]}><Text style={[styles.secondaryButtonText, catalogLoadingMore && styles.disabledButtonText]}>{catalogLoadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</Text></Pressable> : null}
        <Text style={styles.sectionTitle}>تأكيد التوصيل</Text>
        <Text style={styles.muted}>اختر عنوانًا محفوظًا لتأكيد إمكانية التوصيل من هذا المتجر.</Text>
        {addressState.kind === "unauthenticated" ? <View style={styles.statusBox}><Text style={styles.muted}>سجّل الدخول لإضافة عنوان وإتمام الطلب.</Text></View> : null}
        {addressState.kind === "loading" ? <View style={styles.inlineState}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة عناوينك…</Text></View> : null}
        {addressState.kind === "error" ? <View style={styles.inlineState}><Text style={styles.muted}>تعذر قراءة عناوينك المحفوظة.</Text><Pressable accessibilityRole="button" onPress={() => void loadAddresses()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
        {addressState.kind === "ready" && addressState.addresses.length === 0 ? <Text style={styles.muted}>لا يوجد عنوان محفوظ بعد. أضف عنوانًا من قسم العناوين ثم أعد فتح المتجر.</Text> : null}
        {addressState.kind === "ready" && addressState.addresses.length > 0 ? <View style={styles.addressList}>{addressState.addresses.map((address) => { const cityName = cities.find((city) => city.id === address.serviceCityId)?.displayNameAr || "مدينة غير محددة"; const selectedAddress = serviceabilityState.kind !== "idle" && serviceabilityState.addressID === address.id; return <Pressable key={address.id} accessibilityRole="button" accessibilityState={{ selected: selectedAddress, busy: serviceabilityState.kind === "loading" && selectedAddress }} disabled={serviceabilityState.kind === "loading"} onPress={() => void evaluateAddress(address.id)} style={[styles.addressButton, selectedAddress && styles.addressButtonSelected, serviceabilityState.kind === "loading" && styles.disabledButton]}><Text style={styles.meta}>{address.addressText}</Text><Text style={styles.muted}>{cityName}</Text></Pressable>; })}</View> : null}
        {serviceabilityState.kind === "error" ? <View style={styles.statusBox}><Text accessibilityRole="alert" style={styles.statusError}>تعذر تقييم الأهلية. تحقق من الاتصال ثم أعد المحاولة.</Text><Pressable accessibilityRole="button" onPress={() => void evaluateAddress(serviceabilityState.addressID)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة التقييم</Text></Pressable></View> : null}
        {serviceabilityState.kind === "ready" ? <View style={styles.statusBox}><Text style={styles.statusLabel}>نتيجة التوصيل</Text><Text style={serviceabilityState.result.status === "SERVICEABLE" ? styles.statusSuccess : serviceabilityState.result.status === "UNSERVICEABLE" ? styles.statusWarning : styles.statusError}>{serviceabilityMessage(serviceabilityState.result.status)}</Text></View> : null}
        {(catalog?.offers.length ?? 0) > 0 && addressState.kind === "ready" ? <CartCheckout storeId={selected.id} offers={catalog?.offers ?? []} addresses={addressState.addresses} serviceableAddressId={serviceableAddressId} /> : null}
      </View>
    );
  }

  return <View style={styles.container}><Text style={styles.eyebrow}>اكتشاف العميل</Text><Text style={styles.title}>المتاجر المتاحة</Text><Text style={styles.muted}>هذه القائمة ضمن المدينة المختارة، وتعرض المتاجر المتاحة للطلب.</Text><View style={styles.list}>{state.stores.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`فتح متجر ${item.name}`} onPress={() => void openStore(item)} style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardMeta}>{item.serviceCity.displayNameAr} · متاح للطلب</Text></Pressable>)}</View></View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);

  return StyleSheet.create({
    container: { flex: 1, width: "100%", padding: 18, backgroundColor: theme.background, direction: activeDirection },
    state: { alignItems: "center", gap: 12, justifyContent: "center", minHeight: 220, padding: 20, width: "100%", backgroundColor: theme.background, direction: activeDirection },
    detail: { gap: 14, padding: 20, width: "100%", backgroundColor: theme.background, direction: activeDirection },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: "center" },
    title: { color: theme.color, fontSize: 22, fontWeight: "800", textAlign: "center" },
    muted: { color: theme.colorMuted, fontSize: 14, textAlign: "center" },
    list: { gap: 12, paddingVertical: 18 },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 16, borderWidth: 1, gap: 6, padding: 16 },
    cardTitle: { color: theme.color, fontSize: 17, fontWeight: "800", textAlign: startTextAlign },
    cardMeta: { color: theme.colorMuted, fontSize: 13, textAlign: startTextAlign },
    meta: { color: theme.color, fontSize: 14, textAlign: startTextAlign },
    sectionTitle: { color: theme.color, fontSize: 16, fontWeight: "800", marginTop: 8, textAlign: startTextAlign },
    item: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, padding: 12 },
    catalogSection: { gap: 8 },
    inlineState: { alignItems: "center", gap: 8, paddingVertical: 8 },
    addressList: { gap: 8 },
    addressButton: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, padding: 12 },
    addressButtonSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    statusBox: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 6, padding: 12 },
    statusLabel: { color: theme.colorMuted, fontSize: 12, fontWeight: "700", textAlign: startTextAlign },
    statusSuccess: { color: theme.success, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    statusWarning: { color: theme.warning, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    statusError: { color: theme.danger, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    back: { color: theme.interactiveText, fontSize: 15, fontWeight: "800", textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 14, minHeight: 50, justifyContent: "center", paddingHorizontal: 18 },
    buttonText: { color: theme.onAction, fontSize: 15, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, minHeight: 50, justifyContent: "center", paddingHorizontal: 18 },
    secondaryButtonText: { color: theme.color, fontSize: 15, fontWeight: "800" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
  });
}
