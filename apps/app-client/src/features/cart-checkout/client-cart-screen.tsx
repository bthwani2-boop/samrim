import { borders, direction, opacity, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { DeliveryAddress, PublicStoreView, ServiceabilityResponse } from "@bthwani/dsh";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
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
  const { storeId: rawStoreId } = useLocalSearchParams<{ storeId?: string | string[] }>();
  const storeId = Array.isArray(rawStoreId) ? rawStoreId[0] ?? "" : rawStoreId ?? "";
  const router = useRouter();
  const { selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<CartScreenState>({ kind: "loading" });
  const [serviceability, setServiceability] = useState<ServiceabilityState>({ kind: "idle" });

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
    } catch {
      setState({ kind: "error" });
    }
  }, [selectedCityID, storeId]);

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
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text style={styles.title}>تعذر تجهيز السلة</Text><Text style={styles.muted}>تحقق من الاتصال أو أهلية المتجر ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /><BthwaniButton label="العودة إلى المتجر" onPress={() => router.back()} variant="secondary" /></View>;
  }

  const serviceableAddressId = serviceability.kind === "ready" && serviceability.result.status === "SERVICEABLE" ? serviceability.addressId : undefined;
  return (
    <View style={styles.container} accessibilityLabel={`السلة وإتمام الطلب من ${state.store.name}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى المتجر" onPress={() => router.push(`/store/${encodeURIComponent(state.store.id)}` as Href)} style={styles.backButton}><BthwaniIcon name="back" color={theme.interactiveText} size={sizing.iconMd} /><Text style={styles.back}>العودة إلى الكتالوج</Text></Pressable>
      <BthwaniSurface tone="raised" style={styles.storeContext}>
        <View style={styles.storeIcon}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconXl} /></View>
        <View style={styles.storeCopy}><Text style={styles.eyebrow}>سلة الطلب</Text><Text style={styles.title}>{state.store.name}</Text><Text style={styles.muted}>اختر عنوانًا مؤهلًا قبل الإتمام.</Text></View>
      </BthwaniSurface>
      <BthwaniSectionHeader title="عنوان التوصيل" subtitle="يعيد الخادم التحقق من الأهلية عند الإتمام." />
      <View style={styles.addressCard}>
        {state.addresses.length === 0 ? <Text style={styles.muted}>لا يوجد عنوان محفوظ. أضف عنوانًا من الحساب ثم أعد فتح السلة.</Text> : null}
        {state.addresses.map((address) => {
          const selected = serviceability.kind !== "idle" && serviceability.addressId === address.id;
          const busy = serviceability.kind === "loading" && selected;
          return <Pressable key={address.id} accessibilityRole="button" accessibilityState={{ selected, busy }} disabled={serviceability.kind === "loading"} onPress={() => void evaluateAddress(address.id)} style={[styles.address, selected && styles.addressSelected, serviceability.kind === "loading" && styles.disabled]}><Text style={styles.addressText}>{address.addressText}</Text><Text style={styles.muted}>{selected && serviceability.kind === "ready" ? serviceabilityMessage(serviceability.result.status) : "اضغط لتقييم أهلية التوصيل"}</Text>{busy ? <ActivityIndicator color={theme.actionBackground} /> : null}</Pressable>;
        })}
        {serviceability.kind === "error" ? <Text accessibilityRole="alert" style={styles.error}>تعذر تقييم العنوان. أعد المحاولة.</Text> : null}
      </View>
      <CartCheckout storeId={state.store.id} addresses={state.addresses} serviceableAddressId={serviceableAddressId} />
    </View>
  );
}

function serviceabilityMessage(status: ServiceabilityResponse["status"]): string {
  if (status === "SERVICEABLE") return "العنوان مؤهل للتوصيل.";
  if (status === "UNSERVICEABLE") return "العنوان خارج نطاق مدينة المتجر.";
  return "تعذر تأكيد أهلية العنوان الآن.";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { direction: activeDirection, gap: spacing[4], paddingBottom: spacing[4], width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: spacing[3], paddingVertical: spacing[8], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.titleMd, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    backButton: { alignItems: "center", direction: activeDirection, flexDirection: "row", gap: spacing[1], minHeight: sizing.controlMd },
    storeContext: { alignItems: "center", borderRadius: radius.xl, direction: activeDirection, flexDirection: "row", gap: spacing[3], padding: spacing[4] },
    storeIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    storeCopy: { direction: activeDirection, flex: 1, gap: spacing[1] },
    addressCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, direction: activeDirection, gap: spacing[2], padding: spacing[3] },
    address: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2] },
    addressSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    addressText: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    back: { ...typography.body, color: theme.interactiveText, textAlign: startTextAlign },
    error: { ...typography.bodySm, color: theme.danger, textAlign: startTextAlign },
    disabled: { opacity: opacity.disabled },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.sm, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    buttonText: { ...typography.bodyStrong, color: theme.onAction },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    secondaryButtonText: { ...typography.bodyStrong, color: theme.color },
  });
}
