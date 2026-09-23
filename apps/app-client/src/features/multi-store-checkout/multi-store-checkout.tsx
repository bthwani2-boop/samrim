import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, fulfillmentModeLabel, type Cart, type CustomerFulfillmentMode, type DeliveryAddress, type MultiStoreCheckout, type MultiStoreCheckoutResponse, type PublicStoreView } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { cancelMultiStoreCheckout, createMultiStoreCheckout, listOwnDeliveryAddresses, listPublishedStores, readOwnOpenCart } from "../store-discovery/store-discovery-client";

type StoreCart = Readonly<{ store: PublicStoreView; cart: Cart }>;
type ScreenState =
  | { kind: "loading" }
  | { kind: "ready"; storeCarts: ReadonlyArray<StoreCart>; addresses: ReadonlyArray<DeliveryAddress>; selectedAddressID: string; fulfillmentModes: Readonly<Record<string, CustomerFulfillmentMode | null>>; checkout?: MultiStoreCheckout }
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
      const fulfillmentModes = Object.fromEntries(storeCarts.map(({ store }) => [store.id, null]));
      setState({ kind: "ready", storeCarts, addresses: addressResponse.addresses, selectedAddressID: addressResponse.addresses[0]?.id ?? "", fulfillmentModes });
    } catch {
      setState({ kind: "error" });
    }
  }, [selectedCityID]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (busy || state.kind !== "ready" || state.checkout || state.storeCarts.length < 2) return;
    const selectedStoreCarts = state.storeCarts.flatMap(({ store, cart }) => {
      const fulfillmentMode = selectedFulfillmentMode(store, state.fulfillmentModes);
      return fulfillmentMode ? [{ store, cart, fulfillmentMode }] : [];
    });
    if (selectedStoreCarts.length !== state.storeCarts.length) return;
    const requiresDeliveryAddress = selectedStoreCarts.some(({ fulfillmentMode }) => fulfillmentMode !== "CUSTOMER_PICKUP");
    if (requiresDeliveryAddress && !state.selectedAddressID) return;
    setBusy(true);
    setError("");
    try {
      const response = await createMultiStoreCheckout({
        id: `multi_${Crypto.randomUUID()}`,
        children: selectedStoreCarts.map(({ store, cart, fulfillmentMode }) => ({ cartId: cart.id, storeId: store.id, addressId: fulfillmentMode === "CUSTOMER_PICKUP" ? "" : state.selectedAddressID, cartVersion: cart.version, fulfillmentMode })),
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
  const hasUnsupportedStore = state.storeCarts.some(({ store }) => availableCustomerFulfillmentModes(store.fulfillmentModes).length === 0);
  const requiresDeliveryAddress = state.storeCarts.some(({ store }) => { const mode = state.fulfillmentModes[store.id]; return mode !== null && mode !== "CUSTOMER_PICKUP"; });
  return (
    <View style={styles.container} accessibilityLabel="إتمام الطلب من عدة متاجر">
      <BthwaniSurface tone="raised" style={styles.hero}><View style={styles.heroIcon}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconXl} /></View><View style={styles.heroCopy}><Text style={styles.eyebrow}>طلب متعدد المتاجر</Text><Text style={styles.title}>طلبات مستقلة، متابعة واحدة</Text><Text style={styles.muted}>ينشئ بثواني طلبًا مستقلًا لكل متجر ويحفظ نتيجة كل واحد بوضوح.</Text></View></BthwaniSurface>
      <BthwaniSectionHeader title="السلال الجاهزة" subtitle={`${state.storeCarts.length} متاجر ستُعالج بشكل مستقل`} />
      <View style={styles.list}>{state.storeCarts.map(({ store, cart }) => {
        const selectedMode = selectedFulfillmentMode(store, state.fulfillmentModes);
        const availableModes = availableCustomerFulfillmentModes(store.fulfillmentModes);
        return <BthwaniSurface key={store.id} tone="inset" style={styles.storeCard}>
          <View style={styles.storeIcon}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View>
          <View style={styles.storeCopy}><Text style={styles.cardTitle}>{store.name}</Text><Text style={styles.muted}>{cart.lines.length} منتجات · السلة #{cart.version}</Text></View>
          <View style={styles.storeModes} accessibilityLabel={`طريقة استلام الطلب من ${store.name}`}>
            {availableModes.map((mode) => <BthwaniChip key={mode} disabled={busy || Boolean(checkout)} label={fulfillmentModeLabel(mode)} onPress={() => setState((current) => current.kind === "ready" && !current.checkout ? { ...current, fulfillmentModes: { ...current.fulfillmentModes, [store.id]: mode } } : current)} selected={selectedMode === mode} />)}
            {availableModes.length === 0 ? <Text accessibilityRole="alert" style={styles.error}>لا يتوفر لهذا المتجر وضع طلب حاليًا.</Text> : selectedMode === null ? <Text accessibilityRole="alert" style={styles.error}>اختر وضع الطلب لهذا المتجر.</Text> : <Text style={styles.muted}>{modeDescription(selectedMode)}</Text>}
          </View>
        </BthwaniSurface>;
      })}</View>
      {requiresDeliveryAddress ? <>
        <BthwaniSectionHeader title="عنوان التوصيل" subtitle="يُعاد التحقق من الأهلية لكل متجر اخترت توصيله عند الإتمام." />
        <View style={styles.list}>{state.addresses.map((address) => { const selected = address.id === state.selectedAddressID; return <Pressable key={address.id} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setState((current) => current.kind === "ready" ? { ...current, selectedAddressID: address.id } : current)} style={[styles.address, selected && styles.addressSelected]}><Text style={styles.addressText}>{address.addressText}</Text><Text style={styles.muted}>{selected ? "العنوان المختار" : "استخدام هذا العنوان"}</Text></Pressable>; })}</View>
        {state.addresses.length === 0 ? <Text accessibilityRole="alert" style={styles.error}>أضف عنوان توصيل من الحساب قبل إتمام الطلبات التي اخترت توصيلها.</Text> : null}
      </> : hasUnsupportedStore ? <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.error}>لا يمكن إتمام الطلب المتعدد حتى يتوفر وضع طلب مفعّل لكل متجر.</Text></BthwaniSurface> : state.storeCarts.some(({ store }) => !state.fulfillmentModes[store.id]) ? <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.cardTitle}>اختر وضع الطلب لكل متجر</Text><Text style={styles.muted}>سيظهر عنوان التوصيل للمتاجر التي اخترت لها أحد وضعي التوصيل.</Text></BthwaniSurface> : <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.cardTitle}>كل المتاجر المختارة تدعم أوضاع الطلب المحددة</Text><Text style={styles.muted}>يُطلب العنوان فقط للمتاجر التي اخترت لها التوصيل.</Text></BthwaniSurface>}
      {checkout ? <CheckoutSummary checkout={checkout} storeNamesById={Object.fromEntries(state.storeCarts.map(({ store }) => [store.id, store.name]))} styles={styles} theme={theme} /> : <BthwaniButton accessibilityLabel="إتمام الطلب من عدة متاجر" busy={busy} disabled={busy || hasUnsupportedStore || state.storeCarts.some(({ store }) => !state.fulfillmentModes[store.id]) || (requiresDeliveryAddress && !state.selectedAddressID)} label="إتمام الطلب من عدة متاجر" onPress={() => void submit()} />}
      {checkout && canCancel ? <BthwaniButton accessibilityLabel="إلغاء الطلب المتعدد" busy={busy} disabled={busy} label="إلغاء الطلبات التابعة" onPress={() => void cancel()} variant="secondary" /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function selectedFulfillmentMode(store: PublicStoreView, selected: Readonly<Record<string, CustomerFulfillmentMode | null>>): CustomerFulfillmentMode | null {
  const mode = selected[store.id] ?? null;
  return mode && store.fulfillmentModes.includes(mode) ? mode : null;
}

function modeDescription(mode: CustomerFulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "المنصة تتولى التوصيل.";
  if (mode === "PARTNER_CAPTAIN") return "المتجر يختار أحد كباتنه، ولا توجد رسوم توصيل في الإصدار الأول.";
  return "تذهب إلى المتجر لاستلام طلبك بنفسك.";
}

function CheckoutSummary({ checkout, storeNamesById, styles, theme }: { checkout: MultiStoreCheckout; storeNamesById: Readonly<Record<string, string>>; styles: ReturnType<typeof createStyles>; theme: ReturnType<typeof resolveTheme> }) {
  const stateLabel = checkout.state === "COMPLETE" ? "اكتملت كل الطلبات" : checkout.state === "CANCELLED" ? "أُلغيت الطلبات التابعة" : checkout.state === "PARTIAL_FAILURE" ? "اكتمل جزء من الطلبات" : checkout.state === "FAILED" ? "تعذر إنشاء الطلبات" : "جارٍ معالجة الطلبات";
  return <BthwaniSurface tone="raised" style={styles.summary}><Text style={styles.cardTitle}>{stateLabel}</Text><Text style={styles.muted}>{checkout.successfulChildCount} ناجحة · {checkout.failedChildCount} متعثرة من {checkout.childCount}</Text><View style={styles.childList}>{checkout.children.map((child) => <View key={child.id} style={styles.childRow}><View style={styles.childCopy}><Text style={styles.childStore}>{storeNamesById[child.storeId] ?? "المتجر"}</Text><Text style={styles.childMode}>{fulfillmentModeLabel(child.fulfillmentMode)}</Text></View><Text style={{ ...styles.childState, color: child.state === "SUCCEEDED" || child.state === "CANCELLED" ? theme.success : child.state === "FAILED" || child.state === "CANCEL_FAILED" ? theme.danger : theme.warning }}>{checkoutChildStateLabel(child.state)}</Text></View>)}</View></BthwaniSurface>;
}

function checkoutChildStateLabel(state: string): string {
  switch (state) {
    case "SUCCEEDED": return "تم إنشاء الطلب";
    case "FAILED": return "تعذر إنشاء الطلب";
    case "CANCELLING": return "جارٍ الإلغاء";
    case "CANCELLED": return "أُلغي الطلب";
    case "CANCEL_FAILED": return "تعذر الإلغاء";
    default: return "قيد المعالجة";
  }
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
    storeCard: { alignItems: "center", borderRadius: radius.lg, flexDirection: "row", flexWrap: "wrap", gap: spacing[3], padding: spacing[3] },
    storeIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    storeCopy: { flex: 1, gap: spacing[1] },
    storeModes: { flexBasis: "100%", flexDirection: "row", flexWrap: "wrap", gap: spacing[1] },
    address: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    addressSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    addressText: { ...typography.bodyStrong, color: theme.color },
    summary: { borderRadius: radius.lg, gap: spacing[2], padding: spacing[4] },
    childList: { gap: spacing[2], marginTop: spacing[2] },
    childRow: { alignItems: "center", borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing[2] },
    childCopy: { flex: 1, gap: spacing[1] },
    childStore: { ...typography.bodySm, color: theme.color },
    childMode: { ...typography.caption, color: theme.colorMuted },
    childState: { ...typography.label },
    error: { ...typography.bodySm, color: theme.danger },
    pressed: { opacity: opacity.subtle },
  });
}
