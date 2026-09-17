import * as Crypto from "expo-crypto";
import { Link, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppearanceTheme } from "@bthwani/design-system/native";

import { direction, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import { createDshMobileClient, formatMoney, formatQuantity, orderStateLabel, type Cart, type DeliveryAddress, type Order } from "@bthwani/dsh";
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

export function CartCheckout({ storeId, addresses, serviceableAddressId }: { storeId: string; addresses: ReadonlyArray<DeliveryAddress>; serviceableAddressId?: string | undefined }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<CartState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([]);

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
      <Text style={styles.muted}>تُعاد قراءة السعر والأهلية عند فتح السلة وعند الإتمام.</Text>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة السلة…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text style={styles.error}>تعذر قراءة السلة.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
      {state.kind === "empty" ? <Text style={styles.muted}>السلة فارغة. أضف منتجًا من القائمة أعلاه.</Text> : null}
      {state.kind === "ready" ? <>
        <View style={styles.lineList}>{state.cart.lines.map((line) => <View key={line.id} style={styles.line}><Text style={styles.lineTitle}>{line.productName}</Text><Text style={styles.muted}>{formatMoney(line.lineAmountMinor, line.currency)} · الكمية {formatQuantity(line.baseUnit, line.quantityBaseUnits)}</Text></View>)}</View>
        <Text style={styles.total}>الإجمالي: {formatMoney(state.cart.lines.reduce((sum, line) => sum + line.lineAmountMinor, 0), "YER")}</Text>
        {serviceableAddressId && selectedAddress ? <Text style={styles.success}>العنوان مؤهل: {selectedAddress.addressText}</Text> : <Text style={styles.warning}>اختر عنوانًا مؤهلًا من قسم الأهلية قبل الإتمام.</Text>}
        <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || !serviceableAddressId }} disabled={busy || !serviceableAddressId} onPress={() => void checkout()} style={[styles.button, (busy || !serviceableAddressId) && styles.disabledButton]}><Text style={[styles.buttonText, (busy || !serviceableAddressId) && styles.disabledButtonText]}>{busy ? "جارٍ الإتمام…" : "إتمام الطلب"}</Text></Pressable>
      </> : null}
      {order ? <View style={styles.orderBox}><Text style={styles.success}>تم إنشاء الطلب</Text><Text style={styles.muted}>الحالة: {orderStateLabel(order.state)} · الإجمالي: {formatMoney(order.totalAmountMinor, order.currency)}</Text><Link href={`/orders/${encodeURIComponent(order.id)}` as Href} asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>فتح تفاصيل الطلب</Text></Pressable></Link></View> : null}
      {orders.length ? <View style={styles.orderBox}><Text style={styles.lineTitle}>طلباتك الأخيرة</Text>{orders.map((item) => <Text key={item.id} style={styles.muted}>{orderStateLabel(item.state)} · {formatMoney(item.totalAmountMinor, item.currency)}</Text>)}</View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, direction: activeDirection, gap: 10, marginTop: 16, padding: 14 },
    title: { color: theme.color, fontSize: 17, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19, textAlign: startTextAlign },
    state: { alignItems: "center", gap: 8, paddingVertical: 8 },
    lineList: { gap: 8 },
    line: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 3, padding: 10 },
    lineTitle: { color: theme.color, fontSize: 14, fontWeight: "700", textAlign: startTextAlign },
    total: { color: theme.color, fontSize: 15, fontWeight: "800", textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
    secondaryButtonText: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: "center" },
    orderBox: { backgroundColor: theme.actionSoft, borderRadius: 10, gap: 4, padding: 10 },
    success: { color: theme.success, fontSize: 13, fontWeight: "800", textAlign: startTextAlign },
    warning: { color: theme.warning, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
  });
}
