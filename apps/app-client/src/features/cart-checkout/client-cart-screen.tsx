import { borders, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, fulfillmentModeLabel, type CustomerFulfillmentMode, type DeliveryAddress, type PublicStoreView, type ServiceabilityResponse } from "@bthwani/dsh";
import { type Href, Link, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { evaluateStoreServiceability, listOwnDeliveryAddresses, readPublishedStore } from "../store-discovery/store-discovery-client";
import { CartCheckout } from "./cart-checkout";

type CartScreenState =
  | { kind: "loading" }
  | { kind: "ready"; store: PublicStoreView; addresses: ReadonlyArray<DeliveryAddress> }
  | { kind: "error" };

type ServiceabilityState =
  | { kind: "idle" }
  | { kind: "loading"; addressId: string }
  | { kind: "ready"; addressId: string; result: ServiceabilityResponse }
  | { kind: "error"; addressId: string };

export default function ClientCartScreen() {
  const { storeId: rawStoreId, fulfillmentMode: rawFulfillmentMode } = useLocalSearchParams<{ storeId?: string | string[]; fulfillmentMode?: string | string[] }>();
  const storeId = Array.isArray(rawStoreId) ? rawStoreId[0] ?? "" : rawStoreId ?? "";
  const requestedFulfillmentMode = Array.isArray(rawFulfillmentMode) ? rawFulfillmentMode[0] ?? "" : rawFulfillmentMode ?? "";
  const router = useRouter();
  const { selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<CartScreenState>({ kind: "loading" });
  const [serviceability, setServiceability] = useState<ServiceabilityState>({ kind: "idle" });
  const [fulfillmentMode, setFulfillmentMode] = useState<CustomerFulfillmentMode | null>(null);

  const load = useCallback(async () => {
    if (!storeId.trim() || !selectedCityID) {
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    setServiceability({ kind: "idle" });
    try {
      const [store, addressResponse] = await Promise.all([
        readPublishedStore(storeId, selectedCityID),
        listOwnDeliveryAddresses(),
      ]);
      setState({ kind: "ready", store, addresses: addressResponse.addresses });
      const enabledModes = availableCustomerFulfillmentModes(store.fulfillmentModes);
      setFulfillmentMode(enabledModes.includes(requestedFulfillmentMode as CustomerFulfillmentMode) ? requestedFulfillmentMode as CustomerFulfillmentMode : null);
    } catch {
      setState({ kind: "error" });
    }
  }, [requestedFulfillmentMode, selectedCityID, storeId]);

  useEffect(() => { void load(); }, [load]);

  async function evaluateAddress(addressId: string) {
    if (state.kind !== "ready") return;
    setServiceability({ kind: "loading", addressId });
    try {
      const result = await evaluateStoreServiceability(state.store.id, addressId);
      setServiceability({ kind: "ready", addressId, result });
    } catch {
      setServiceability({ kind: "error", addressId });
    }
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
  return (
    <View style={styles.container} accessibilityLabel={`السلة وإتمام الطلب من ${state.store.name}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى المتجر" onPress={() => router.push(`/store/${encodeURIComponent(state.store.id)}` as Href)} style={styles.backButton}><BthwaniIcon name="back" color={theme.interactiveText} size={sizing.iconMd} /><Text style={styles.back}>العودة إلى الكتالوج</Text></Pressable>
      <BthwaniSurface tone="raised" style={styles.storeContext}>
        <View style={styles.storeIcon}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconXl} /></View>
        <View style={styles.storeCopy}><Text style={styles.eyebrow}>سلة الطلب</Text><Text style={styles.title}>{state.store.name}</Text><Text style={styles.muted}>{fulfillmentMode === "BTHWANI_CAPTAIN" ? "المنصة تتولى التوصيل؛ اختر عنوانًا مؤهلًا." : fulfillmentMode === "PARTNER_CAPTAIN" ? "المتجر يختار كابتنه لتوصيل الطلب؛ اختر عنوانًا مؤهلًا." : fulfillmentMode === "CUSTOMER_PICKUP" ? "اذهب إلى المتجر لاستلام طلبك بنفسك." : "اختر وضع الطلب قبل الإتمام."}</Text></View>
      </BthwaniSurface>
      <BthwaniSectionHeader title="طريقة الاستلام" subtitle="اختر من الخيارات التي يدعمها هذا المتجر." />
      <View style={styles.addressCard} accessibilityLabel="خيارات استلام الطلب">
        {availableFulfillmentModes.map((mode) => <BthwaniChip key={mode} label={fulfillmentModeLabel(mode)} onPress={() => { setFulfillmentMode(mode); setServiceability({ kind: "idle" }); }} selected={fulfillmentMode === mode} />)}
      </View>
      {fulfillmentMode !== null && fulfillmentMode !== "CUSTOMER_PICKUP" ? <>
        <BthwaniSectionHeader title="عنوان التوصيل" subtitle="يعيد الخادم التحقق من الأهلية عند الإتمام." />
        <View style={styles.addressCard}>
          {state.addresses.length === 0 ? <><Text style={styles.muted}>لا يوجد عنوان محفوظ. أضف عنوانًا من الحساب ثم أعد فتح السلة.</Text><Link href="/account" asChild><BthwaniButton accessibilityLabel="إدارة العناوين من الحساب" label="إدارة العناوين" variant="secondary" /></Link></> : null}
          {state.addresses.map((address) => {
            const selected = serviceability.kind !== "idle" && serviceability.addressId === address.id;
            const busy = serviceability.kind === "loading" && selected;
            return <Pressable key={address.id} accessibilityRole="button" accessibilityState={{ selected, busy }} disabled={serviceability.kind === "loading"} onPress={() => void evaluateAddress(address.id)} style={[styles.address, selected && styles.addressSelected, serviceability.kind === "loading" && styles.disabled]}><Text style={styles.addressText}>{address.addressText}</Text><Text style={styles.muted}>{selected && serviceability.kind === "ready" ? serviceabilityMessage(serviceability.result.status) : "اضغط لتقييم أهلية التوصيل"}</Text>{busy ? <ActivityIndicator color={theme.actionBackground} /> : null}</Pressable>;
          })}
          {serviceability.kind === "error" ? <Text accessibilityRole="alert" style={styles.error}>تعذر تقييم العنوان. أعد المحاولة.</Text> : null}
        </View>
      </> : fulfillmentMode === "CUSTOMER_PICKUP" ? <BthwaniSurface tone="inset" style={styles.addressCard}><Text style={styles.addressText}>استلم بنفسك من المتجر</Text><Text style={styles.muted}>اذهب إلى المتجر لاستلام طلبك وادفع قيمة المنتجات نقدًا للمتجر.</Text></BthwaniSurface> : <Text accessibilityRole="alert" style={styles.error}>اختر أحد أوضاع الطلب المتاحة لإتمام الشراء.</Text>}
      {fulfillmentMode ? <CartCheckout storeId={state.store.id} addresses={state.addresses} serviceableAddressId={serviceableAddressId} fulfillmentMode={fulfillmentMode} /> : null}
    </View>
  );
}

function serviceabilityMessage(status: ServiceabilityResponse["status"]): string {
  if (status === "SERVICEABLE") return "العنوان مؤهل للتوصيل.";
  if (status === "UNSERVICEABLE") return "العنوان خارج نطاق مدينة المتجر.";
  return "تعذر تأكيد أهلية العنوان الآن.";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { gap: spacing[4], paddingBottom: spacing[4], width: "100%" },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[8], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleMd, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    backButton: { alignItems: "center", flexDirection: "row", gap: spacing[1], minHeight: sizing.controlMd },
    storeContext: { alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4] },
    storeIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    storeCopy: { flex: 1, gap: spacing[1] },
    addressCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    address: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2] },
    addressSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    addressText: { ...typography.bodyStrong, color: theme.color },
    back: { ...typography.body, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.danger },
    disabled: { opacity: opacity.disabled },
  });
}
