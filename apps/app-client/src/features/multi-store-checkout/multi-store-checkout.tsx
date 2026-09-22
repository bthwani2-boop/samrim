import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { Cart, DeliveryAddress, MultiStoreCheckout, MultiStoreCheckoutResponse, PublicStoreView } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { cancelMultiStoreCheckout, createMultiStoreCheckout, listOwnDeliveryAddresses, listPublishedStores, readOwnOpenCart } from "../store-discovery/store-discovery-client";

type StoreCart = Readonly<{ store: PublicStoreView; cart: Cart }>;
type ScreenState =
  | { kind: "loading" }
  | { kind: "ready"; storeCarts: ReadonlyArray<StoreCart>; addresses: ReadonlyArray<DeliveryAddress>; selectedAddressID: string; checkout?: MultiStoreCheckout }
  | { kind: "empty"; addresses: ReadonlyArray<DeliveryAddress> }
  | { kind: "error" };

export default function MultiStoreCheckoutScreen() {
  const { selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!selectedCityID) {
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    setError("");
    try {
      const [stores, addressResponse] = await Promise.all([listPublishedStores(selectedCityID), listOwnDeliveryAddresses()]);
      const carts = await Promise.allSettled(stores.map(async (store) => ({ store, cart: (await readOwnOpenCart(store.id)).cart })));
      const storeCarts = carts.flatMap((result) => result.status === "fulfilled" && result.value.cart.lines.length ? [result.value] : []);
      if (storeCarts.length < 2) {
        setState({ kind: "empty", addresses: addressResponse.addresses });
        return;
      }
      setState({ kind: "ready", storeCarts, addresses: addressResponse.addresses, selectedAddressID: addressResponse.addresses[0]?.id ?? "" });
    } catch {
      setState({ kind: "error" });
    }
  }, [selectedCityID]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (busy || state.kind !== "ready" || state.checkout || !state.selectedAddressID || state.storeCarts.length < 2) return;
    setBusy(true);
    setError("");
    try {
      const response = await createMultiStoreCheckout({
        id: `multi_${Crypto.randomUUID()}`,
        children: state.storeCarts.map(({ store, cart }) => ({ cartId: cart.id, storeId: store.id, addressId: state.selectedAddressID, cartVersion: cart.version, fulfillmentMode: "BTHWANI_CAPTAIN" })),
      });
      setState((current) => current.kind === "ready" ? { ...current, checkout: response.checkout } : current);
    } catch {
      setError("تعذر إتمام الطلبات من المتاجر. راجع السلال ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy || state.kind !== "ready" || !state.checkout || state.checkout.successfulChildCount < 1) return;
    setBusy(true);
    setError("");
    try {
      const response: MultiStoreCheckoutResponse = await cancelMultiStoreCheckout(state.checkout.id, state.checkout.version);
      setState((current) => current.kind === "ready" ? { ...current, checkout: response.checkout } : current);
    } catch {
      setError("تعذر إلغاء الطلبات التابعة بالكامل. ستظهر نتيجة كل متجر بشكل مستقل.");
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <View style={styles.state} accessibilityLabel="جارٍ تجهيز طلب المتاجر"><BthwaniSkeleton width="50%" height={26} /><BthwaniSkeleton height={92} /><BthwaniSkeleton height={120} /></View>;
  if (state.kind === "error") return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" style={styles.title}>تعذر تجهيز الطلب المتعدد</Text><Text style={styles.muted}>تحقق من مدينة الخدمة والاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /></View>;
  if (state.kind === "empty") return <View style={styles.state}><BthwaniIcon name="cart" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>أضف منتجات من متجرين على الأقل</Text><Text style={styles.muted}>افتح كتالوج كل متجر وأضف منتجًا إلى سلته، ثم عد إلى هنا لإتمام الطلبات معًا.</Text><BthwaniButton label="تحديث السلال" onPress={() => void load()} variant="secondary" /></View>;

  const checkout = state.checkout;
  const canCancel = Boolean(checkout && checkout.successfulChildCount > 0 && checkout.state !== "CANCELLED");
  return (
    <View style={styles.container} accessibilityLabel="إتمام الطلب من عدة متاجر">
      <BthwaniSurface tone="raised" style={styles.hero}><View style={styles.heroIcon}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconXl} /></View><View style={styles.heroCopy}><Text style={styles.eyebrow}>طلب متعدد المتاجر</Text><Text style={styles.title}>طلبات مستقلة، متابعة واحدة</Text><Text style={styles.muted}>ينشئ بثواني طلبًا مستقلًا لكل متجر ويحفظ نتيجة كل واحد بوضوح.</Text></View></BthwaniSurface>
      <BthwaniSectionHeader title="السلال الجاهزة" subtitle={`${state.storeCarts.length} متاجر ستُعالج بشكل مستقل`} />
      <View style={styles.list}>{state.storeCarts.map(({ store, cart }) => <BthwaniSurface key={store.id} tone="inset" style={styles.storeCard}><View style={styles.storeIcon}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View><View style={styles.storeCopy}><Text style={styles.cardTitle}>{store.name}</Text><Text style={styles.muted}>{cart.lines.length} منتجات · السلة #{cart.version}</Text></View><BthwaniIcon name="success" color={theme.success} size={sizing.iconMd} /></BthwaniSurface>)}</View>
      <BthwaniSectionHeader title="عنوان التوصيل" subtitle="يُعاد التحقق من الأهلية لكل متجر عند الإتمام." />
      <View style={styles.list}>{state.addresses.map((address) => { const selected = address.id === state.selectedAddressID; return <Pressable key={address.id} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setState((current) => current.kind === "ready" ? { ...current, selectedAddressID: address.id } : current)} style={[styles.address, selected && styles.addressSelected]}><Text style={styles.addressText}>{address.addressText}</Text><Text style={styles.muted}>{selected ? "العنوان المختار" : "استخدام هذا العنوان"}</Text></Pressable>; })}</View>
      {state.addresses.length === 0 ? <Text accessibilityRole="alert" style={styles.error}>أضف عنوان توصيل من الحساب قبل الإتمام.</Text> : null}
      {checkout ? <CheckoutSummary checkout={checkout} styles={styles} theme={theme} /> : <BthwaniButton accessibilityLabel="إتمام الطلب من عدة متاجر" busy={busy} disabled={busy || !state.selectedAddressID} label="إتمام الطلب من عدة متاجر" onPress={() => void submit()} />}
      {checkout && canCancel ? <BthwaniButton accessibilityLabel="إلغاء الطلب المتعدد" busy={busy} disabled={busy} label="إلغاء الطلبات التابعة" onPress={() => void cancel()} variant="secondary" /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function CheckoutSummary({ checkout, styles, theme }: { checkout: MultiStoreCheckout; styles: ReturnType<typeof createStyles>; theme: ReturnType<typeof resolveTheme> }) {
  const stateLabel = checkout.state === "COMPLETE" ? "اكتملت كل الطلبات" : checkout.state === "CANCELLED" ? "أُلغيت الطلبات التابعة" : checkout.state === "PARTIAL_FAILURE" ? "اكتمل جزء من الطلبات" : checkout.state === "FAILED" ? "تعذر إنشاء الطلبات" : "جارٍ معالجة الطلبات";
  return <BthwaniSurface tone="raised" style={styles.summary}><Text style={styles.cardTitle}>{stateLabel}</Text><Text style={styles.muted}>{checkout.successfulChildCount} ناجحة · {checkout.failedChildCount} متعثرة من {checkout.childCount}</Text><View style={styles.childList}>{checkout.children.map((child) => <View key={child.id} style={styles.childRow}><Text style={styles.childStore}>{child.storeId}</Text><Text style={{ ...styles.childState, color: child.state === "SUCCEEDED" || child.state === "CANCELLED" ? theme.success : child.state === "FAILED" || child.state === "CANCEL_FAILED" ? theme.danger : theme.warning }}>{child.state}</Text></View>)}</View></BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    hero: { alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    heroIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    heroCopy: { flex: 1, gap: spacing[1] },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleLg, color: theme.color, textAlign: "center" },
    cardTitle: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    list: { gap: spacing[2] },
    storeCard: { alignItems: "center", borderRadius: radius.lg, flexDirection: "row", gap: spacing[3], padding: spacing[3] },
    storeIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    storeCopy: { flex: 1, gap: spacing[1] },
    address: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    addressSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    addressText: { ...typography.bodyStrong, color: theme.color },
    summary: { borderRadius: radius.lg, gap: spacing[2], padding: spacing[4] },
    childList: { gap: spacing[2], marginTop: spacing[2] },
    childRow: { alignItems: "center", borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing[2] },
    childStore: { ...typography.bodySm, color: theme.color, flex: 1 },
    childState: { ...typography.label },
    error: { ...typography.bodySm, color: theme.danger },
    pressed: { opacity: opacity.subtle },
  });
}
