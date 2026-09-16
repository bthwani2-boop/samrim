import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { direction, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import { createDshMobileClient, formatMoney, formatOrderDate, formatQuantity, orderStateLabel, type Order } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type OrdersState = { kind: "loading" } | { kind: "ready"; orders: ReadonlyArray<Order> } | { kind: "error" };

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

export default function ClientOrders() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<OrdersState>({ kind: "loading" });
  const [selected, setSelected] = useState<Order | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setSelected(null);
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().listClientOrders(token, 50);
      setState({ kind: "ready", orders: result.orders });
    } catch (error) {
      console.error("DSH client orders read failed", error);
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function readOrder(orderID: string) {
    try {
      const token = await getUsableIdentityAccessToken();
      setSelected((await client().readOrder(token, orderID)).order);
    } catch (error) {
      console.error("DSH client order detail read failed", error);
    }
  }

  return <View style={styles.container} accessibilityLabel="طلبات العميل"><Text style={styles.title}>طلباتي</Text><Text style={styles.muted}>تُعرض طلباتك وحالتها الحالية من المنصة، ويمكن تحديثها في أي وقت.</Text>{state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الطلبات…</Text></View> : null}{state.kind === "error" ? <View style={styles.state}><Text style={styles.error}>تعذر قراءة الطلبات.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}{state.kind === "ready" && state.orders.length === 0 ? <Text style={styles.muted}>لا توجد طلبات محفوظة.</Text> : null}{state.kind === "ready" ? <View style={styles.list}>{state.orders.map((order) => <Pressable key={order.id} accessibilityRole="button" accessibilityLabel={`قراءة الطلب بتاريخ ${formatOrderDate(order.createdAt)}`} onPress={() => void readOrder(order.id)} style={styles.order}><Text style={styles.orderTitle}>طلب بتاريخ {formatOrderDate(order.createdAt)}</Text><Text style={styles.muted}>{orderStateLabel(order.state)} · {formatMoney(order.totalAmountMinor, order.currency)} · {order.lines.length} منتجات</Text></Pressable>)}</View> : null}{selected ? <View style={styles.detail}><Text style={styles.orderTitle}>تفاصيل الطلب</Text><Text style={styles.muted}>الحالة: {orderStateLabel(selected.state)} · {formatOrderDate(selected.createdAt)}</Text><Text style={styles.muted}>العنوان: {selected.addressText}</Text>{selected.lines.map((line) => <Text key={line.id} style={styles.muted}>{line.productName} · {formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)} · {formatMoney(line.lineAmountMinor, line.currency)}</Text>)}</View> : null}</View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, direction: activeDirection, gap: 10, marginTop: 16, padding: 14, width: "100%" },
    state: { alignItems: "center", gap: 8, paddingVertical: 8 },
    title: { color: theme.color, fontSize: 17, fontWeight: "800", textAlign: startTextAlign },
    orderTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19, textAlign: startTextAlign },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
    list: { gap: 8 },
    order: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, padding: 12 },
    detail: { backgroundColor: theme.actionSoft, borderRadius: 12, gap: 4, padding: 12 },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
    secondaryButtonText: { color: theme.color, fontSize: 13, fontWeight: "700" },
  });
}
