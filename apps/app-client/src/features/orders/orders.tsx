import { type Href, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { direction, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import { createDshMobileClient, formatMoney, formatOrderDate, orderStateLabel, type Order } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type OrdersState = { kind: "loading" } | { kind: "ready"; orders: ReadonlyArray<Order> } | { kind: "error" };

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

export default function ClientOrders() {
  const router = useRouter();
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<OrdersState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const token = await getUsableIdentityAccessToken();
      setState({ kind: "ready", orders: (await client().listClientOrders(token, 50)).orders });
    } catch (error) {
      console.error("DSH client orders read failed", error);
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "loading") {
    return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة الطلبات" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الطلبات…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر قراءة الطلبات</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View>;
  }

  return (
    <View style={styles.container} accessibilityLabel="طلبات العميل">
      <Text style={styles.eyebrow}>سجل الطلبات</Text>
      <Text style={styles.title}>طلباتي</Text>
      <Text style={styles.muted}>اختر طلبًا لقراءة التفاصيل والحالة الحالية ومسار الاسترداد المتاح.</Text>
      {state.orders.length === 0 ? <Text style={styles.muted}>لا توجد طلبات محفوظة.</Text> : null}
      <View style={styles.list}>
        {state.orders.map((order) => <Pressable key={order.id} accessibilityRole="button" accessibilityLabel={`قراءة الطلب بتاريخ ${formatOrderDate(order.createdAt)}`} onPress={() => router.push(`/orders/${encodeURIComponent(order.id)}` as Href)} style={({ pressed }) => [styles.order, pressed && styles.pressed]}><Text style={styles.orderTitle}>طلب بتاريخ {formatOrderDate(order.createdAt)}</Text><Text style={styles.muted}>{orderStateLabel(order.state)} · {formatMoney(order.totalAmountMinor, order.currency)} · {order.lines.length} منتجات</Text></Pressable>)}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, direction: activeDirection, gap: 10, marginTop: 16, padding: 14, width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: 10, paddingVertical: 28, width: "100%" },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: startTextAlign },
    title: { color: theme.color, fontSize: 20, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
    list: { gap: 8 },
    order: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, padding: 12 },
    pressed: { opacity: 0.74 },
    orderTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
  });
}
