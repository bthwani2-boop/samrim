import { borders, direction, elevation, opacity, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, formatOrderDate, type Order, orderStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
    return <View style={styles.state} accessibilityLabel="جارٍ تجهيز الطلبات"><BthwaniSkeleton width="42%" height={28} /><BthwaniSkeleton height={112} /><BthwaniSkeleton height={112} /></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text style={styles.title}>تعذر قراءة الطلبات</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View>;
  }

  return (
    <View style={styles.container} accessibilityLabel="طلبات العميل">
      <Text style={styles.eyebrow}>متابعة رحلتك</Text>
      <Text style={styles.title}>طلباتي</Text>
      <Text style={styles.muted}>تابع حالة طلباتك وافتح أي طلب لمراجعة التفاصيل الحالية.</Text>
      {state.orders.length === 0 ? (
        <BthwaniSurface tone="inset" style={styles.emptyState}>
          <View style={styles.emptyIcon}><BthwaniIcon name="orders" color={theme.interactiveText} size={sizing.iconXl} /></View>
          <Text style={styles.cardTitle}>لا توجد طلبات بعد</Text>
          <Text style={styles.muted}>عندما تنشئ طلبًا سيظهر هنا مع حالته وتفاصيله.</Text>
          <BthwaniButton label="استكشف المتاجر" onPress={() => router.push("/home" as Href)} />
        </BthwaniSurface>
      ) : (
        <View style={styles.list}>
          {state.orders.map((order) => <Pressable key={order.id} accessibilityRole="button" accessibilityLabel={`قراءة الطلب بتاريخ ${formatOrderDate(order.createdAt)}`} onPress={() => router.push(`/orders/${encodeURIComponent(order.id)}` as Href)} style={({ pressed }) => [styles.order, pressed && styles.pressed]}>
            <View style={styles.orderTop}><View style={styles.orderTitleBlock}><Text style={styles.orderTitle}>طلب {formatOrderDate(order.createdAt)}</Text><Text style={styles.orderAddress} numberOfLines={1}>{order.addressText}</Text></View><View style={styles.statusPill}><Text style={styles.statusText}>{orderStateLabel(order.state)}</Text></View></View>
            <View style={styles.orderBottom}><Text style={styles.orderMeta}>{order.lines.length} {order.lines.length === 1 ? "منتج" : "منتجات"}</Text><Text style={styles.orderTotal}>{formatMoney(order.totalAmountMinor, order.currency)}</Text><BthwaniIcon name="forward" color={theme.colorMuted} size={sizing.iconMd} /></View>
          </Pressable>)}
        </View>
      )}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.background, direction: activeDirection, flexGrow: 1, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.hero, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    state: { alignItems: "center", direction: activeDirection, gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    emptyState: { alignItems: "center", borderRadius: radius.xl, gap: spacing[3], padding: spacing[5] },
    emptyIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    cardTitle: { ...typography.titleSm, color: theme.color, textAlign: "center" },
    list: { direction: activeDirection, gap: spacing[3] },
    order: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, direction: activeDirection, gap: spacing[3], padding: spacing[4], ...elevation.raised },
    orderTop: { alignItems: "flex-start", direction: activeDirection, flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    orderTitleBlock: { direction: activeDirection, flex: 1, gap: spacing[1] },
    orderTitle: { ...typography.titleSm, color: theme.color, textAlign: startTextAlign },
    orderAddress: { ...typography.caption, color: theme.colorMuted, textAlign: startTextAlign },
    statusPill: { backgroundColor: theme.actionSoft, borderRadius: radius.round, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    statusText: { ...typography.caption, color: theme.interactiveText, textAlign: "center" },
    orderBottom: { alignItems: "center", borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, direction: activeDirection, flexDirection: "row", gap: spacing[2], paddingTop: spacing[3] },
    orderMeta: { ...typography.bodySm, color: theme.colorMuted, flex: 1, textAlign: startTextAlign },
    orderTotal: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    pressed: { opacity: opacity.subtle },
  });
}
