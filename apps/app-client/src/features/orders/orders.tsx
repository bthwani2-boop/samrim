import { borders, direction, opacity, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, formatOrderDate, type Order, orderStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
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
const theme = useAppearanceTheme();
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
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, direction: activeDirection, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: spacing[3], paddingVertical: spacing[8], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.titleMd, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    list: { gap: spacing[2] },
    order: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    pressed: { opacity: opacity.subtle },
    orderTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    secondaryButtonText: { ...typography.bodyStrong, color: theme.color },
  });
}
