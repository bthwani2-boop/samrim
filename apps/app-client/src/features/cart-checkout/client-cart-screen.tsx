import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

import { direction, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import type { DeliveryAddress, PublicCatalogResponse, PublicStoreView, ServiceabilityResponse } from "@bthwani/dsh";
import { evaluateStoreServiceability, listOwnDeliveryAddresses, readPublicStoreCatalog, readPublishedStore } from "../store-discovery/store-discovery-client";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { CartCheckout } from "./cart-checkout";

type CartScreenState =
  | { kind: "loading" }
  | { kind: "ready"; store: PublicStoreView; catalog: PublicCatalogResponse; addresses: ReadonlyArray<DeliveryAddress> }
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
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
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
      const [store, catalog, addressResponse] = await Promise.all([
        readPublishedStore(storeId, selectedCityID),
        readPublicStoreCatalog(storeId, selectedCityID),
        listOwnDeliveryAddresses(),
      ]);
      setState({ kind: "ready", store, catalog, addresses: addressResponse.addresses });
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
    return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ تجهيز السلة" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الكتالوج والسلة والعناوين…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر تجهيز السلة</Text><Text style={styles.muted}>تحقق من الاتصال أو أهلية المتجر ثم أعد المحاولة.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>إعادة المحاولة</Text></Pressable><Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>العودة إلى المتجر</Text></Pressable></View>;
  }

  const serviceableAddressId = serviceability.kind === "ready" && serviceability.result.status === "SERVICEABLE" ? serviceability.addressId : undefined;
  return (
    <View style={styles.container} accessibilityLabel={`السلة وإتمام الطلب من ${state.store.name}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى المتجر" onPress={() => router.push(`/store/${encodeURIComponent(state.store.id)}` as Href)}><Text style={styles.back}>العودة إلى الكتالوج</Text></Pressable>
      <Text style={styles.eyebrow}>السلة</Text>
      <Text style={styles.title}>{state.store.name}</Text>
      <Text style={styles.muted}>اختر عنوانًا مؤهلًا قبل إتمام الطلب. يعيد الخادم التحقق من السعر والأهلية عند الإتمام.</Text>
      <View style={styles.addressCard}>
        <Text style={styles.sectionTitle}>عنوان التوصيل</Text>
        {state.addresses.length === 0 ? <Text style={styles.muted}>لا يوجد عنوان محفوظ. أضف عنوانًا من الحساب ثم أعد فتح السلة.</Text> : null}
        {state.addresses.map((address) => {
          const selected = serviceability.kind !== "idle" && serviceability.addressId === address.id;
          const busy = serviceability.kind === "loading" && selected;
          return <Pressable key={address.id} accessibilityRole="button" accessibilityState={{ selected, busy }} disabled={serviceability.kind === "loading"} onPress={() => void evaluateAddress(address.id)} style={[styles.address, selected && styles.addressSelected, serviceability.kind === "loading" && styles.disabled]}><Text style={styles.addressText}>{address.addressText}</Text><Text style={styles.muted}>{selected && serviceability.kind === "ready" ? serviceabilityMessage(serviceability.result.status) : "اضغط لتقييم أهلية التوصيل"}</Text>{busy ? <ActivityIndicator color={theme.actionBackground} /> : null}</Pressable>;
        })}
        {serviceability.kind === "error" ? <Text accessibilityRole="alert" style={styles.error}>تعذر تقييم العنوان. أعد المحاولة.</Text> : null}
      </View>
      <CartCheckout storeId={state.store.id} offers={state.catalog.offers} addresses={state.addresses} serviceableAddressId={serviceableAddressId} />
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
    container: { direction: activeDirection, gap: 10, width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: 10, paddingVertical: 28, width: "100%" },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: startTextAlign },
    title: { color: theme.color, fontSize: 20, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
    sectionTitle: { color: theme.color, fontSize: 15, fontWeight: "800", textAlign: startTextAlign },
    addressCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, direction: activeDirection, gap: 8, padding: 12 },
    address: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, gap: 3, padding: 10 },
    addressSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    addressText: { color: theme.color, fontSize: 14, fontWeight: "700", textAlign: startTextAlign },
    back: { color: theme.interactiveText, fontSize: 14, fontWeight: "700", textAlign: startTextAlign },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
    disabled: { opacity: 0.65 },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
  });
}
