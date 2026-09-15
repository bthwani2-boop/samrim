import { resolveTheme } from "@bthwani/design-system";
import type { DeliveryAddress, PublicCatalogResponse, PublicStoreView, ServiceabilityResponse } from "@bthwani/dsh";
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

export default function StoreDiscovery() {
  const { cities, selectedCityID } = useServiceCityScope();
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });
  const [selected, setSelected] = useState<PublicStoreView | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalogResponse | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [addressState, setAddressState] = useState<AddressState>({ kind: "idle" });
  const [serviceabilityState, setServiceabilityState] = useState<ServiceabilityState>({ kind: "idle" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setSelected(null);
    setCatalog(null);
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
    setAddressState({ kind: "loading" });
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
    try {
      const result = await listOwnDeliveryAddresses();
      setAddressState({ kind: "ready", addresses: result.addresses });
    } catch {
      setAddressState({ kind: "error" });
    }
  }

  async function loadAddresses() {
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
    return <View style={styles.state}><Text style={styles.title}>تعذر اكتشاف المتاجر</Text><Text style={styles.muted}>تحقق من اتصال DSH ثم أعد المحاولة.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>إعادة المحاولة</Text></Pressable></View>;
  }
  if (state.kind === "empty") {
    return <View style={styles.state}><Text style={styles.title}>لا توجد متاجر منشورة</Text><Text style={styles.muted}>ستظهر المتاجر هنا بعد اجتياز النشر الكانوني.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>تحديث</Text></Pressable></View>;
  }
  if (detailState === "loading") {
    return <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ فتح تفاصيل المتجر…</Text></View>;
  }
  if (detailState === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر قراءة تفاصيل المتجر</Text><Pressable accessibilityRole="button" onPress={() => setDetailState("idle")} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>العودة إلى المتاجر</Text></Pressable></View>;
  }
  if (selected) {
    const serviceableAddressId = serviceabilityState.kind === "ready" && serviceabilityState.result.status === "SERVICEABLE" ? serviceabilityState.addressID : undefined;
    return <View style={styles.detail}><Pressable accessibilityRole="button" onPress={() => { setSelected(null); setCatalog(null); setDetailState("idle"); setAddressState({ kind: "idle" }); setServiceabilityState({ kind: "idle" }); }}><Text style={styles.back}>‹ المتاجر المنشورة</Text></Pressable><Text style={styles.title}>{selected.name}</Text><Text style={styles.muted}>متجر منشور ومتاح للاكتشاف</Text><Text style={styles.meta}>معرّف المتجر: {selected.id}</Text><Text style={styles.meta}>مدينة الخدمة: {selected.serviceCity.displayNameAr}</Text><Text style={styles.meta}>المجال التجاري: {catalog?.verticalId || selected.primaryVerticalId}</Text><Text style={styles.meta}>إصدار الحالة: {selected.version}</Text><Text style={styles.sectionTitle}>المنتجات المتاحة</Text>{catalog?.offers.length ? catalog.offers.map((offer) => <View key={offer.offerId} style={styles.item}><Text style={styles.meta}>{offer.productName}</Text><Text style={styles.meta}>{offer.priceMinor} {offer.currency} · {offer.sellUnit === "kg" ? "بالكيلو" : "بالقطعة"}</Text><Text style={styles.muted}>متاح · إصدار العرض {offer.version}</Text></View>) : <Text style={styles.muted}>لا توجد منتجات متاحة حاليًا.</Text>}<Text style={styles.sectionTitle}>تأكيد أهلية العنوان</Text><Text style={styles.muted}>اختر عنوانًا محفوظًا ليقيّم DSH توافق مدينة العنوان مع مدينة المتجر.</Text>{addressState.kind === "loading" ? <View style={styles.inlineState}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة عناوينك…</Text></View> : null}{addressState.kind === "error" ? <View style={styles.inlineState}><Text style={styles.muted}>تعذر قراءة عناوينك المحفوظة.</Text><Pressable accessibilityRole="button" onPress={() => void loadAddresses()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}{addressState.kind === "ready" && addressState.addresses.length === 0 ? <Text style={styles.muted}>لا يوجد عنوان محفوظ بعد. أضف عنوانًا من قسم العناوين ثم أعد فتح المتجر.</Text> : null}{addressState.kind === "ready" && addressState.addresses.length > 0 ? <View style={styles.addressList}>{addressState.addresses.map((address) => { const cityName = cities.find((city) => city.id === address.serviceCityId)?.displayNameAr || "مدينة غير محددة"; const selectedAddress = serviceabilityState.kind !== "idle" && serviceabilityState.addressID === address.id; return <Pressable key={address.id} accessibilityRole="button" accessibilityState={{ selected: selectedAddress, busy: serviceabilityState.kind === "loading" && selectedAddress }} disabled={serviceabilityState.kind === "loading"} onPress={() => void evaluateAddress(address.id)} style={[styles.addressButton, selectedAddress && styles.addressButtonSelected]}><Text style={styles.meta}>{address.addressText}</Text><Text style={styles.muted}>{cityName} · الإصدار {address.version}</Text></Pressable>; })}</View> : null}{serviceabilityState.kind === "error" ? <View style={styles.statusBox}><Text accessibilityRole="alert" style={styles.statusError}>تعذر تقييم الأهلية. تحقق من الاتصال ثم أعد المحاولة.</Text><Pressable accessibilityRole="button" onPress={() => void evaluateAddress(serviceabilityState.addressID)} style={styles.secondaryButton}>إعادة التقييم</Pressable></View> : null}{serviceabilityState.kind === "ready" ? <View style={styles.statusBox}><Text style={styles.statusLabel}>نتيجة نطاق الخدمة</Text><Text style={serviceabilityState.result.status === "SERVICEABLE" ? styles.statusSuccess : serviceabilityState.result.status === "UNSERVICEABLE" ? styles.statusWarning : styles.statusError}>{serviceabilityMessage(serviceabilityState.result.status)}</Text><Text style={styles.muted}>سياسة التقييم: {serviceabilityState.result.evidence.policyVersion}</Text></View> : null}{catalog?.offers.length && addressState.kind === "ready" ? <CartCheckout storeId={selected.id} offers={catalog.offers} addresses={addressState.addresses} serviceableAddressId={serviceableAddressId} /> : null}</View>;
  }

  return <View style={styles.container}><Text style={styles.eyebrow}>اكتشاف العميل</Text><Text style={styles.title}>المتاجر المنشورة</Text><Text style={styles.muted}>هذه القائمة تأتي من DSH ضمن المدينة المختارة، ولا تعرض إلا المتاجر التي اجتازت بوابات النشر الحالية.</Text><View style={styles.list}>{state.stores.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`فتح متجر ${item.name}`} onPress={() => void openStore(item)} style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardMeta}>{item.serviceCity.displayNameAr} · متجر منشور · إصدار {item.version}</Text></Pressable>)}</View></View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { flex: 1, width: "100%", padding: 18, backgroundColor: theme.background },
    state: { alignItems: "center", gap: 12, justifyContent: "center", minHeight: 220, padding: 20, width: "100%", backgroundColor: theme.background },
    detail: { gap: 14, padding: 20, width: "100%", backgroundColor: theme.background },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: "center" },
    title: { color: theme.structure, fontSize: 22, fontWeight: "800", textAlign: "center" },
    muted: { color: theme.colorMuted, fontSize: 14, textAlign: "center" },
    list: { gap: 12, paddingVertical: 18 },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 16, borderWidth: 1, gap: 6, padding: 16 },
    cardTitle: { color: theme.structure, fontSize: 17, fontWeight: "800", textAlign: "left" },
    cardMeta: { color: theme.colorMuted, fontSize: 13, textAlign: "left" },
    meta: { color: theme.structure, fontSize: 14, textAlign: "left" },
    sectionTitle: { color: theme.structure, fontSize: 16, fontWeight: "800", marginTop: 8, textAlign: "left" },
    item: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 4, padding: 12 },
    inlineState: { alignItems: "center", gap: 8, paddingVertical: 8 },
    addressList: { gap: 8 },
    addressButton: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, padding: 12 },
    addressButtonSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    statusBox: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 6, padding: 12 },
    statusLabel: { color: theme.colorMuted, fontSize: 12, fontWeight: "700", textAlign: "left" },
    statusSuccess: { color: theme.success, fontSize: 14, fontWeight: "800", textAlign: "left" },
    statusWarning: { color: theme.warning, fontSize: 14, fontWeight: "800", textAlign: "left" },
    statusError: { color: theme.danger, fontSize: 14, fontWeight: "800", textAlign: "left" },
    back: { color: theme.interactiveText, fontSize: 15, fontWeight: "800", textAlign: "left" },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 14, minHeight: 50, justifyContent: "center", paddingHorizontal: 18 },
    buttonText: { color: theme.surface, fontSize: 15, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, minHeight: 50, justifyContent: "center", paddingHorizontal: 18 },
    secondaryButtonText: { color: theme.structure, fontSize: 15, fontWeight: "800" },
  });
}
