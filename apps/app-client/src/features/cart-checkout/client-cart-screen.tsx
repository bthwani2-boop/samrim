import { borders, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, type CustomerFulfillmentMode, type DeliveryAddress, fulfillmentModeLabel, type PublicStoreView, type ServiceabilityResponse } from "@bthwani/dsh";
import { type Href, Link, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { evaluateStoreServiceability, listOwnDeliveryAddresses, readPublishedStore } from "../store-discovery/store-discovery-client";
import { CartCheckout, type CheckoutFooterState } from "./cart-checkout";

const fulfillmentDetails: Readonly<Record<CustomerFulfillmentMode, string>> = {
  BTHWANI_CAPTAIN: "كابتن من بثواني",
  PARTNER_CAPTAIN: "كابتن تابع للمتجر",
  CUSTOMER_PICKUP: "تستلم من المتجر",
};

type CartScreenState =
  | { kind: "loading" }
  | { kind: "ready"; store: PublicStoreView }
  | { kind: "error" };

type AddressesState =
  | { kind: "idle"; addresses: ReadonlyArray<DeliveryAddress> }
  | { kind: "loading"; addresses: ReadonlyArray<DeliveryAddress> }
  | { kind: "ready"; addresses: ReadonlyArray<DeliveryAddress> }
  | { kind: "error"; addresses: ReadonlyArray<DeliveryAddress> };

type ServiceabilityState =
  | { kind: "idle" }
  | { kind: "loading"; addressId: string }
  | { kind: "ready"; addressId: string; result: ServiceabilityResponse }
  | { kind: "error"; addressId: string };

export default function ClientCartScreen() {
  const { storeId: rawStoreId, fulfillmentMode: rawFulfillmentMode, promotionCode: rawPromotionCode } = useLocalSearchParams<{ storeId?: string | string[]; fulfillmentMode?: string | string[]; promotionCode?: string | string[] }>();
  const storeId = Array.isArray(rawStoreId) ? rawStoreId[0] ?? "" : rawStoreId ?? "";
  const requestedFulfillmentMode = Array.isArray(rawFulfillmentMode) ? rawFulfillmentMode[0] ?? "" : rawFulfillmentMode ?? "";
  const requestedPromotionCode = Array.isArray(rawPromotionCode) ? rawPromotionCode[0] ?? "" : rawPromotionCode ?? "";
  const router = useRouter();
  const { selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<CartScreenState>({ kind: "loading" });
  const [addressesState, setAddressesState] = useState<AddressesState>({ kind: "idle", addresses: [] });
  const [serviceability, setServiceability] = useState<ServiceabilityState>({ kind: "idle" });
  const [fulfillmentMode, setFulfillmentMode] = useState<CustomerFulfillmentMode | null>(null);
  const [expandedAddresses, setExpandedAddresses] = useState(false);
  const [footer, setFooter] = useState<CheckoutFooterState | null>(null);
  const checkoutAction = useRef<() => void>(() => undefined);
  const updateFooter = useCallback((next: CheckoutFooterState | null) => setFooter(next), []);
  const loadRequestID = useRef(0);
  const addressRequestID = useRef(0);
  const serviceabilityRequestID = useRef(0);
  const fulfillmentModeRef = useRef(fulfillmentMode);
  fulfillmentModeRef.current = fulfillmentMode;
  const scopeRef = useRef({ storeId, selectedCityID });
  scopeRef.current = { storeId, selectedCityID };

  const loadAddresses = useCallback(async () => {
    const requestID = ++addressRequestID.current;
    const isCurrent = () => requestID === addressRequestID.current && scopeRef.current.storeId === storeId && scopeRef.current.selectedCityID === selectedCityID;
    setAddressesState((current) => ({ kind: "loading", addresses: current.addresses }));
    try {
      const response = await listOwnDeliveryAddresses();
      if (isCurrent()) setAddressesState({ kind: "ready", addresses: response.addresses });
    } catch {
      if (isCurrent()) setAddressesState((current) => ({ kind: "error", addresses: current.addresses }));
    }
  }, [selectedCityID, storeId]);

  const load = useCallback(async () => {
    const requestID = ++loadRequestID.current;
    serviceabilityRequestID.current += 1;
    const isCurrent = () => requestID === loadRequestID.current && scopeRef.current.storeId === storeId && scopeRef.current.selectedCityID === selectedCityID;
    if (!storeId.trim() || !selectedCityID) {
      if (isCurrent()) setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    addressRequestID.current += 1;
    setAddressesState({ kind: "idle", addresses: [] });
    setServiceability({ kind: "idle" });
    try {
      const store = await readPublishedStore(storeId, selectedCityID);
      if (!isCurrent()) return;
      setState({ kind: "ready", store });
      const enabledModes = availableCustomerFulfillmentModes(store.fulfillmentModes);
      setFulfillmentMode(enabledModes.includes(requestedFulfillmentMode as CustomerFulfillmentMode) ? requestedFulfillmentMode as CustomerFulfillmentMode : enabledModes.length === 1 ? enabledModes[0] ?? null : null);
    } catch {
      if (isCurrent()) setState({ kind: "error" });
    }
  }, [requestedFulfillmentMode, selectedCityID, storeId]);

  useFocusEffect(useCallback(() => {
    if (state.kind === "ready" && fulfillmentModeRef.current !== null && fulfillmentModeRef.current !== "CUSTOMER_PICKUP") void loadAddresses();
    return () => { addressRequestID.current += 1; };
  }, [loadAddresses, state.kind]));

  useEffect(() => {
    void load();
    return () => {
      loadRequestID.current += 1;
      addressRequestID.current += 1;
      serviceabilityRequestID.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (state.kind !== "ready" || !fulfillmentMode || fulfillmentMode === "CUSTOMER_PICKUP"
        || addressesState.kind !== "ready" || addressesState.addresses.length !== 1
        || serviceability.kind !== "idle") return;
    void evaluateAddress(addressesState.addresses[0]!.id);
  }, [state.kind, fulfillmentMode, addressesState, serviceability.kind]);

  async function evaluateAddress(addressId: string) {
    if (state.kind !== "ready") return;
    const requestID = ++serviceabilityRequestID.current;
    const targetStoreID = state.store.id;
    const targetCityID = selectedCityID;
    const isCurrent = () => requestID === serviceabilityRequestID.current && scopeRef.current.storeId === targetStoreID && scopeRef.current.selectedCityID === targetCityID;
    setServiceability({ kind: "loading", addressId });
    try {
      const result = await evaluateStoreServiceability(targetStoreID, addressId);
      if (isCurrent()) setServiceability({ kind: "ready", addressId, result });
    } catch {
      if (isCurrent()) setServiceability({ kind: "error", addressId });
    }
  }

  if (state.kind === "ready" && (state.store.id !== storeId || state.store.serviceCity.id !== selectedCityID)) {
    return <View style={styles.state} accessibilityLabel="جارٍ تحديث المتجر"><BthwaniSkeleton width="35%" height={28} /><BthwaniSkeleton height={88} /><BthwaniSkeleton height={152} /></View>;
  }

  if (state.kind === "loading") {
    return <View style={styles.state} accessibilityLabel="جارٍ تجهيز السلة"><BthwaniSkeleton width="35%" height={28} /><BthwaniSkeleton height={88} /><BthwaniSkeleton height={152} /></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر تجهيز السلة</Text><Text style={styles.muted}>تحقق من الاتصال أو أهلية المتجر ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /><BthwaniButton label="العودة إلى المتجر" onPress={() => router.back()} variant="secondary" /></View>;
  }

  const availableFulfillmentModes = availableCustomerFulfillmentModes(state.store.fulfillmentModes);
  if (availableFulfillmentModes.length === 0) return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text style={styles.title}>لا تتوفر طريقة استلام مدعومة لهذا المتجر</Text><Text style={styles.muted}>اختر متجرًا آخر؛ خيارات هذا المتجر لا تسمح حاليًا بإتمام طلب العميل.</Text><BthwaniButton label="العودة إلى المتجر" onPress={() => router.push(`/store/${encodeURIComponent(state.store.id)}` as Href)} variant="secondary" /></View>;
  const serviceableAddressId = fulfillmentMode !== null && fulfillmentMode !== "CUSTOMER_PICKUP" && serviceability.kind === "ready" && serviceability.result.status === "SERVICEABLE" ? serviceability.addressId : undefined;
  const chosenAddress = serviceability.kind === "ready" ? addressesState.addresses.find((address) => address.id === serviceability.addressId) : undefined;
  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.page}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>تأكيد الطلب</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى المتجر" onPress={() => router.push(("/store/" + encodeURIComponent(state.store.id)) as Href)} style={styles.headerBack}>
            <BthwaniIcon name="back" color={theme.interactiveText} size={sizing.iconLg} />
          </Pressable>
        </View>
        <BthwaniSurface tone="raised" style={styles.storeCard}>
          <View style={styles.storeIcon}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconXl} /></View>
          <View style={styles.storeCopy}><Text style={styles.subheading}>تأكيد الطلب من</Text><Text style={styles.storeName}>{state.store.name}</Text><Text style={styles.muted}>راجع اختياراتك وفاتورتك قبل إتمام الطلب.</Text></View>
        </BthwaniSurface>
        <BthwaniSurface tone="raised" style={styles.section}>
          <Text style={styles.sectionTitle}>طريقة التنفيذ</Text>
          <Text style={styles.muted}>اختر الطريقة المناسبة لك.</Text>
          <View style={styles.modes}>
            {availableFulfillmentModes.map((mode) => {
              const selected = fulfillmentMode === mode;
              return <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={fulfillmentModeLabel(mode)} onPress={() => {
                if (selected) return;
                serviceabilityRequestID.current += 1;
                setFulfillmentMode(mode);
                setServiceability({ kind: "idle" });
                setExpandedAddresses(false);
                if (mode !== "CUSTOMER_PICKUP" && addressesState.kind === "idle") void loadAddresses();
              }} style={[styles.mode, selected && styles.modeSelected]}>
                <BthwaniIcon name={mode === "CUSTOMER_PICKUP" ? "account" : mode === "PARTNER_CAPTAIN" ? "cart" : "location"} color={selected ? theme.interactiveText : theme.colorMuted} size={sizing.iconXl} />
                <Text numberOfLines={2} style={[styles.modeTitle, selected && styles.modeTitleSelected]}>{fulfillmentModeLabel(mode)}</Text>
                <Text style={styles.modeDescription}>{fulfillmentDetails[mode]}</Text>
                <Text style={[styles.modeCheck, selected && styles.modeCheckSelected]}>{selected ? "●" : "○"}</Text>
              </Pressable>;
            })}
          </View>
        </BthwaniSurface>
        {fulfillmentMode !== null && fulfillmentMode !== "CUSTOMER_PICKUP" ? <BthwaniSurface tone="raised" style={styles.section}>
          <View style={styles.row}>
            <BthwaniIcon name="location" color={theme.interactiveText} size={sizing.iconLg}/>
            <View style={styles.rowCopy}><Text style={styles.sectionTitle}>عنوان التوصيل</Text><Text style={styles.muted} numberOfLines={2}>{chosenAddress ? chosenAddress.addressText : "اختر عنوانًا مؤهلًا لتوصيل الطلب"}</Text></View>
            <Pressable style={styles.change} accessibilityRole="button" accessibilityLabel="تغيير عنوان التوصيل" accessibilityState={{ expanded: expandedAddresses }} onPress={() => setExpandedAddresses((value) => !value)}><Text style={styles.changeLabel}>{expandedAddresses ? "إغلاق" : "تغيير"}</Text></Pressable>
          </View>
          {addressesState.kind === "loading" ? <ActivityIndicator color={theme.actionBackground} /> : null}
          {addressesState.kind === "error" ? <><Text accessibilityRole="alert" style={styles.error}>تعذر تحميل العناوين.</Text><BthwaniButton label="إعادة تحميل العناوين" onPress={() => void loadAddresses()} variant="secondary"/></> : null}
          {addressesState.kind === "ready" && addressesState.addresses.length === 0 ? <Link href={"/addresses" as Href} asChild><BthwaniButton label="إضافة عنوان توصيل" variant="secondary" /></Link> : null}
          {expandedAddresses ? <View style={styles.addresses}>
            {addressesState.addresses.map((address) => {
              const selected = serviceability.kind !== "idle" && serviceability.addressId === address.id;
              return <Pressable key={address.id} accessibilityRole="button" accessibilityState={{ selected }} disabled={serviceability.kind === "loading"} style={[styles.address, selected && styles.addressSelected]} onPress={() => { setExpandedAddresses(false); void evaluateAddress(address.id); }}>
                <Text style={styles.addressText}>{address.addressText}</Text><Text style={styles.muted}>{selected && serviceability.kind === "ready" ? serviceabilityMessage(serviceability.result.status) : "اختيار هذا العنوان"}</Text>
              </Pressable>;
            })}
            <Link href={"/addresses" as Href} asChild><BthwaniButton label="إضافة عنوان آخر" variant="secondary"/></Link>
          </View> : null}
          {serviceability.kind === "loading" ? <Text style={styles.muted}>جارٍ التحقق من عنوان التوصيل…</Text> : null}
          {serviceability.kind === "error" ? <Text accessibilityRole="alert" style={styles.error}>تعذر التحقق من العنوان؛ أعد اختياره.</Text> : null}
          {serviceability.kind === "ready" && serviceability.result.status !== "SERVICEABLE" ? <Text accessibilityRole="alert" style={styles.error}>{serviceabilityMessage(serviceability.result.status)}</Text> : null}
        </BthwaniSurface> : fulfillmentMode === "CUSTOMER_PICKUP" ? <BthwaniSurface tone="raised" style={styles.section}><View style={styles.row}>
          <BthwaniIcon name="cart" color={theme.interactiveText} size={sizing.iconLg}/>
          <View style={styles.rowCopy}><Text style={styles.sectionTitle}>استلام بنفسي</Text><Text style={styles.muted}>ستظهر تعليمات الاستلام بعد تجهيز الطلب.</Text></View>
        </View></BthwaniSurface> : <Text accessibilityRole="alert" style={styles.error}>اختر طريقة تنفيذ الطلب أولًا.</Text>}
        {fulfillmentMode ? <CartCheckout key={state.store.id} storeId={state.store.id} addresses={addressesState.addresses} serviceableAddressId={serviceableAddressId} fulfillmentMode={fulfillmentMode} initialPromotionCode={requestedPromotionCode} onFooterChange={updateFooter} checkoutAction={checkoutAction}/> : null}
      </ScrollView>
      {footer ? <View style={styles.footer}>
        <View style={styles.footerAmount}><Text style={styles.footerCaption}>الإجمالي الكلي</Text><Text style={styles.footerNumber}>{footer.total}</Text></View>
        <View style={styles.footerCTA}><BthwaniButton label={footer.label} disabled={footer.disabled} busy={footer.busy} onPress={() => checkoutAction.current()}/></View>
      </View> : null}
    </SafeAreaView>
  );
}

function serviceabilityMessage(status: ServiceabilityResponse["status"]): string {
  if (status === "SERVICEABLE") return "العنوان مؤهل للتوصيل.";
  if (status === "UNSERVICEABLE") return "العنوان خارج نطاق مدينة المتجر.";
  return "تعذر تأكيد أهلية العنوان الآن.";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    scroll: { paddingHorizontal: spacing[3], paddingVertical: spacing[3], gap: spacing[3], paddingBottom: spacing[8] },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[8] },
    header: { flexDirection: "row", alignItems: "center", minHeight: sizing.controlLg },
    title: { ...typography.titleLg, color: theme.color, textAlign: "center", flex: 1 },
    headerBack: { minWidth: sizing.controlLg, minHeight: sizing.controlLg, justifyContent: "center", alignItems: "center" },
    storeCard: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[3], padding: spacing[3], borderRadius: radius.xl },
    storeIcon: { backgroundColor: theme.actionBackground, padding: spacing[3], borderRadius: radius.lg },
    storeCopy: { flex: 1, gap: spacing[1] },
    subheading: { ...typography.caption, color: theme.interactiveText, textAlign: "right" },
    storeName: { ...typography.titleMd, color: theme.color, textAlign: "right" },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
    section: { padding: spacing[3], borderRadius: radius.xl, gap: spacing[2] },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    modes: { flexDirection: "row", gap: spacing[2], marginTop: spacing[2] },
    mode: { flex: 1, minWidth: 0, minHeight: 128, paddingHorizontal: spacing[1], paddingVertical: spacing[3], gap: spacing[2], alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline },
    modeSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText, borderWidth: 2 },
    modeTitle: { ...typography.bodyStrong, color: theme.color, fontSize: 12, textAlign: "center" },
    modeTitleSelected: { color: theme.interactiveText },
    modeDescription: { ...typography.caption, color: theme.colorMuted, fontSize: 10, textAlign: "center" },
    modeCheck: { ...typography.bodySm, color: theme.colorMuted },
    modeCheckSelected: { color: theme.interactiveText },
    row: { flexDirection: "row", gap: spacing[3], minHeight: 52, alignItems: "center" },
    rowCopy: { flex: 1, gap: spacing[1] },
    change: { minWidth: 56, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[2], borderWidth: borders.hairline, borderColor: theme.borderColorStrong, borderRadius: radius.md },
    changeLabel: { ...typography.bodyStrong, color: theme.interactiveText },
    addresses: { gap: spacing[2] },
    address: { borderColor: theme.borderColor, borderWidth: borders.hairline, backgroundColor: theme.surfaceRaised, borderRadius: radius.md, gap: spacing[1], padding: spacing[3] },
    addressSelected: { borderColor: theme.interactiveText, backgroundColor: theme.actionSoft },
    addressText: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    error: { ...typography.bodySm, color: theme.danger, textAlign: "right" },
    footer: { flexDirection: "row", alignItems: "center", gap: spacing[2], padding: spacing[3], backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: borders.hairline },
    footerAmount: { flexShrink: 1, alignItems: "flex-end", gap: spacing[1] },
    footerCaption: { ...typography.caption, color: theme.interactiveText },
    footerNumber: { ...typography.titleMd, color: theme.color },
    footerCTA: { flex: 1 },
  });
}
