import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import type { CatalogStoreOffer, Cart, DeliveryAddress, Order } from "@bthwani/dsh";
import { createDshMobileClient } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type CartState = { kind: "loading" } | { kind: "empty" } | { kind: "ready"; cart: Cart } | { kind: "error" };

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { kind?: unknown; status?: unknown }).kind === "http" && (error as { status?: unknown }).status === 404);
}

export function CartCheckout({ storeId, offers, addresses, serviceableAddressId }: { storeId: string; offers: ReadonlyArray<CatalogStoreOffer>; addresses: ReadonlyArray<DeliveryAddress>; serviceableAddressId?: string | undefined }) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<CartState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([]);
  const [selectedModifierOptionIds, setSelectedModifierOptionIds] = useState<Record<string, ReadonlyArray<string>>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().readOpenCart(token, storeId);
      setState({ kind: "ready", cart: result.cart });
    } catch (cause) {
      if (isNotFound(cause)) setState({ kind: "empty" });
      else { console.error("DSH cart read failed", cause); setState({ kind: "error" }); }
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  async function add(offer: CatalogStoreOffer) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const quantity = Number(quantities[offer.offerId] ?? String(offer.quantityMinBaseUnits));
      if (!Number.isSafeInteger(quantity) || !isQuantityAllowed(offer, quantity)) {
        setError("الكمية لا تطابق الحد الأدنى أو الأقصى أو خطوة الكمية لهذا العرض.");
        return;
      }
      const version = state.kind === "ready" ? state.cart.version : 0;
      const result = await client().upsertCartLine(token, { storeId, storeOfferId: offer.offerId, quantityBaseUnits: quantity, selectedModifierOptionIds: selectedModifierOptionIds[offer.offerId] ?? [] }, version);
      setState({ kind: "ready", cart: result.cart });
    } catch (cause) { console.error("DSH cart add failed", cause); setError("تعذر إضافة المنتج. أعد قراءة السلة وحاول مرة أخرى."); }
    finally { setBusy(false); }
  }

  function toggleModifier(offer: CatalogStoreOffer, groupId: string, optionId: string, maxSelections: number) {
    setSelectedModifierOptionIds((current) => {
      const selected = [...(current[offer.offerId] ?? [])];
      const option = selected.indexOf(optionId);
      if (option >= 0) {
        selected.splice(option, 1);
      } else {
        const groupOptionIds = new Set(offer.modifierGroups.find((group) => group.id === groupId)?.options.map((item) => item.id) ?? []);
        const withoutGroup = selected.filter((id) => !groupOptionIds.has(id));
        if (maxSelections === 1) selected.splice(0, selected.length, ...withoutGroup, optionId);
        else if (selected.filter((id) => groupOptionIds.has(id)).length < maxSelections) selected.push(optionId);
      }
      return { ...current, [offer.offerId]: selected };
    });
  }

  async function checkout() {
    if (busy || state.kind !== "ready" || !state.cart.lines.length || !serviceableAddressId) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().checkoutCart(token, { cartId: state.cart.id, storeId, addressId: serviceableAddressId }, state.cart.version);
      setOrder(result.order);
      setOrders((await client().listClientOrders(token, 20)).orders);
      setState({ kind: "empty" });
    } catch (cause) { console.error("DSH checkout failed", cause); setError("تعذر إتمام الطلب. تأكد من أهلية العنوان ثم أعد المحاولة."); }
    finally { setBusy(false); }
  }

  const selectedAddress = addresses.find((address) => address.id === serviceableAddressId);
  return (
    <View style={styles.container} accessibilityLabel="السلة وإتمام الطلب">
      <Text style={styles.title}>السلة وإتمام الطلب</Text>
      <Text style={styles.muted}>تُعاد قراءة السعر والأهلية عند الإضافة وعند الإتمام.</Text>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة السلة…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text style={styles.error}>تعذر قراءة السلة.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
      {state.kind === "empty" ? <Text style={styles.muted}>السلة فارغة. أضف منتجًا من القائمة أعلاه.</Text> : null}
      {state.kind === "ready" ? <>
        <View style={styles.lineList}>{state.cart.lines.map((line) => <View key={line.id} style={styles.line}><Text style={styles.lineTitle}>{line.productName}</Text><Text style={styles.muted}>{line.lineAmountMinor} {line.currency} · الكمية {quantityLabel(line.baseUnit, line.quantityBaseUnits)} · v{line.offerVersion}</Text></View>)}</View>
        <Text style={styles.total}>الإجمالي: {state.cart.lines.reduce((sum, line) => sum + line.lineAmountMinor, 0)} YER</Text>
        {serviceableAddressId && selectedAddress ? <Text style={styles.success}>العنوان مؤهل: {selectedAddress.addressText}</Text> : <Text style={styles.warning}>اختر عنوانًا مؤهلًا من قسم الأهلية قبل الإتمام.</Text>}
        <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || !serviceableAddressId }} disabled={busy || !serviceableAddressId} onPress={() => void checkout()} style={styles.button}><Text style={styles.buttonText}>{busy ? "جارٍ الإتمام…" : "إتمام الطلب"}</Text></Pressable>
      </> : null}
      {offers.length ? <View style={styles.offerList}>{offers.map((offer) => { const selectedOptions = selectedModifierOptionIds[offer.offerId] ?? []; const quantity = quantities[offer.offerId] ?? String(offer.quantityMinBaseUnits); return <View key={offer.offerId} style={styles.offerCard}><Text style={styles.lineTitle}>{offer.productName} · {offer.priceMinor} {offer.currency}</Text><Text style={styles.muted}>الكمية: {offer.quantityMinBaseUnits}–{offer.quantityMaxBaseUnits} بخطوة {offer.quantityStepBaseUnits} {quantityUnit(offer.baseUnit)}</Text><TextInput accessibilityLabel={`كمية ${offer.productName}`} editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantities((current) => ({ ...current, [offer.offerId]: value.replace(/[^0-9]/g, "") }))} value={quantity} style={styles.quantityInput} />{offer.modifierGroups.map((group) => <View key={group.id} style={styles.modifierGroup}><Text style={styles.muted}>{group.nameAr}{group.required ? " · مطلوب" : ""}</Text><View style={styles.modifierOptions}>{group.options.filter((option) => option.availability).map((option) => { const selectedOption = selectedOptions.includes(option.id); return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: selectedOption, disabled: busy }} disabled={busy} onPress={() => toggleModifier(offer, group.id, option.id, group.maxSelections)} style={[styles.modifierOption, selectedOption && styles.modifierOptionSelected]}><Text style={styles.secondaryButtonText}>{option.nameAr}{option.priceDeltaMinor ? ` · +${option.priceDeltaMinor} ${offer.currency}` : ""}</Text></Pressable>; })}</View></View>)}<Pressable accessibilityRole="button" accessibilityLabel={`إضافة ${offer.productName}`} disabled={busy} onPress={() => void add(offer)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إضافة إلى السلة</Text></Pressable></View>; })}</View> : null}
      {order ? <View style={styles.orderBox}><Text style={styles.success}>تم إنشاء الطلب</Text><Text style={styles.muted}>المعرّف: {order.id} · الحالة: {order.state} · الإجمالي: {order.totalAmountMinor} {order.currency}</Text></View> : null}
      {orders.length ? <View style={styles.orderBox}><Text style={styles.lineTitle}>طلباتك الأخيرة</Text>{orders.map((item) => <Text key={item.id} style={styles.muted}>{item.id} · {item.state} · {item.totalAmountMinor} {item.currency}</Text>)}</View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function quantityLabel(baseUnit: "COUNT" | "GRAM" | "MILLILITER", quantity: number): string {
  if (baseUnit === "COUNT") return `${quantity} قطعة`;
  if (baseUnit === "GRAM") return `${quantity} غرام`;
  return `${quantity} مل`;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 10, marginTop: 16, padding: 14 },
    title: { color: theme.structure, fontSize: 17, fontWeight: "800", textAlign: "left" },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19, textAlign: "left" },
    state: { alignItems: "center", gap: 8, paddingVertical: 8 },
    lineList: { gap: 8 },
    line: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 3, padding: 10 },
    lineTitle: { color: theme.structure, fontSize: 14, fontWeight: "700", textAlign: "left" },
    total: { color: theme.structure, fontSize: 15, fontWeight: "800", textAlign: "left" },
    offerList: { gap: 8 },
    offerCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, gap: 8, padding: 10 },
    modifierGroup: { gap: 6 },
    modifierOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    modifierOption: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 7 },
    modifierOptionSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
    buttonText: { color: theme.surface, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
    secondaryButtonText: { color: theme.structure, fontSize: 13, fontWeight: "700", textAlign: "center" },
    quantityInput: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.structure, minHeight: 40, paddingHorizontal: 10, textAlign: "left" },
    orderBox: { backgroundColor: theme.actionSoft, borderRadius: 10, gap: 4, padding: 10 },
    success: { color: theme.success, fontSize: 13, fontWeight: "800", textAlign: "left" },
    warning: { color: theme.warning, fontSize: 13, fontWeight: "700", textAlign: "left" },
    error: { color: theme.danger, fontSize: 13, textAlign: "left" },
  });
}

function isQuantityAllowed(offer: CatalogStoreOffer, quantity: number): boolean {
  return quantity >= offer.quantityMinBaseUnits && quantity <= offer.quantityMaxBaseUnits && (quantity - offer.quantityMinBaseUnits) % offer.quantityStepBaseUnits === 0;
}

function quantityUnit(baseUnit: CatalogStoreOffer["baseUnit"]): string {
  if (baseUnit === "COUNT") return "قطعة";
  if (baseUnit === "GRAM") return "غرام";
  return "مل";
}
