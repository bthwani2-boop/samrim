import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, formatOrderDate, fulfillmentModeLabel, paymentStateLabel, type Cart, type Order, orderStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";

type OrdersState = { kind: "loading" } | { kind: "ready"; orders: ReadonlyArray<Order> } | { kind: "error" } | { kind: "auth_required" };

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
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "delivery" | "pickup">("all");
  const [repeatingOrderID, setRepeatingOrderID] = useState("");
  const [repeatError, setRepeatError] = useState("");

  const load = useCallback(async (preserveCurrent = false) => {
    if (preserveCurrent) setRefreshing(true);
    else setState({ kind: "loading" });
    setRefreshError("");
    try {
      const token = await getUsableIdentityAccessToken();
      setState({ kind: "ready", orders: (await client().listClientOrders(token, 50)).orders });
    } catch (error) {
      console.error("DSH client orders read failed", error);
      if (preserveCurrent) setRefreshError("تعذر تحديث الطلبات. ما زالت القائمة الحالية معروضة.");
      else setState({ kind: "error" });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const visibleOrders = useMemo(() => {
    if (state.kind !== "ready" || fulfillmentFilter === "all") return state.kind === "ready" ? state.orders : [];
    return state.orders.filter((order) => fulfillmentFilter === "pickup" ? order.fulfillmentMode === "CUSTOMER_PICKUP" : order.fulfillmentMode !== "CUSTOMER_PICKUP");
  }, [fulfillmentFilter, state]);

  const repeatOrder = useCallback(async (order: Order) => {
    if (repeatingOrderID || !order.lines.length) return;
    setRepeatingOrderID(order.id);
    setRepeatError("");
    let appliedCount = 0;
    try {
      const token = await getUsableIdentityAccessToken();
      let cart: Cart | null = null;
      try {
        cart = (await client().readOpenCart(token, order.storeId)).cart;
      } catch (error) {
        const missingCart = typeof error === "object" && error !== null && "kind" in error && (error as { kind?: unknown }).kind === "http" && "status" in error && (error as { status?: unknown }).status === 404;
        if (!missingCart) throw error;
      }

      const plan = order.lines.map((line) => {
        const existing = cart?.lines.find((cartLine) => cartLine.storeOfferId === line.storeOfferId);
        if (existing && !sameIDs(existing.selectedModifierOptionIds, line.selectedModifierOptionIds)) {
          return { error: "توجد في السلة خيارات مختلفة لأحد المنتجات. راجع السلة قبل تكرار الطلب." as const };
        }
        const quantityBaseUnits = (existing?.quantityBaseUnits ?? 0) + line.requestedQuantityBaseUnits;
        if (quantityBaseUnits < line.quantityMinBaseUnits || quantityBaseUnits > line.quantityMaxBaseUnits || (quantityBaseUnits - line.quantityMinBaseUnits) % line.quantityStepBaseUnits !== 0) {
          return { error: `لا يمكن جمع كمية «${line.productName}» مع الكمية الحالية في السلة ضمن حدود المنتج.` as const };
        }
        return { error: "" as const, storeOfferId: line.storeOfferId, quantityBaseUnits, selectedModifierOptionIds: line.selectedModifierOptionIds };
      });
      const planError = plan.find((item) => item.error)?.error;
      if (planError) {
        setRepeatError(planError);
        return;
      }

      let expectedVersion = cart?.version ?? 0;
      for (const item of plan) {
        if (item.error) continue;
        const response = await client().upsertCartLine(token, {
          storeId: order.storeId,
          storeOfferId: item.storeOfferId,
          quantityBaseUnits: item.quantityBaseUnits,
          selectedModifierOptionIds: item.selectedModifierOptionIds,
        }, expectedVersion);
        expectedVersion = response.cart.version;
        appliedCount += 1;
      }
      router.push(`/cart/${encodeURIComponent(order.storeId)}?fulfillmentMode=${encodeURIComponent(order.fulfillmentMode)}` as Href);
    } catch (error) {
      console.error("DSH client order repeat failed", error);
      setRepeatError(appliedCount ? `تعذر إكمال التكرار؛ أُضيف ${appliedCount} من ${order.lines.length} منتجات. راجع السلة قبل المتابعة.` : "تعذر تكرار الطلب. قد يتغير توفر المنتجات أو خياراتها؛ حدّث القائمة وحاول مجددًا.");
    } finally {
      setRepeatingOrderID("");
    }
  }, [repeatingOrderID, router]);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);

  useEffect(() => {
    if (identityState.kind !== "authenticated") {
      setState({ kind: "auth_required" });
      setRefreshError("");
      return;
    }
    void load();
  }, [identityState.kind, load]);

  if (state.kind === "auth_required") {
    return <View style={styles.state}><BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>سجّل الدخول لمتابعة طلباتك</Text><Text style={styles.muted}>ستظهر طلباتك وحالاتها هنا بعد تسجيل الدخول.</Text><BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/orders" as Href)} /></View>;
  }
  if (state.kind === "loading") {
    return <View style={styles.state} accessibilityLabel="جارٍ تجهيز الطلبات"><BthwaniSkeleton width="42%" height={28} /><BthwaniSkeleton height={112} /><BthwaniSkeleton height={112} /></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر قراءة الطلبات</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View>;
  }

  return (
    <View style={styles.container} accessibilityLabel="طلبات العميل">
      <Text style={styles.eyebrow}>متابعة رحلتك</Text>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}><Text style={styles.title}>طلباتي</Text><Text style={styles.muted}>تابع حالة طلباتك وافتح أي طلب لمراجعة التفاصيل الحالية.</Text></View>
        <BthwaniButton accessibilityLabel="تحديث قائمة الطلبات" busy={refreshing} label="تحديث" onPress={() => void load(true)} variant="secondary" />
      </View>
      {refreshError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{refreshError}</Text> : null}
      <View accessibilityLabel="تصفية الطلبات حسب طريقة الاستلام" style={styles.filterRow}>
        <BthwaniChip label="الكل" selected={fulfillmentFilter === "all"} onPress={() => setFulfillmentFilter("all")} />
        <BthwaniChip label="التوصيل" selected={fulfillmentFilter === "delivery"} onPress={() => setFulfillmentFilter("delivery")} />
        <BthwaniChip label="الاستلام من المتجر" selected={fulfillmentFilter === "pickup"} onPress={() => setFulfillmentFilter("pickup")} />
      </View>
      {repeatError ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{repeatError}</Text> : null}
      {state.orders.length === 0 ? (
        <BthwaniSurface tone="inset" style={styles.emptyState}>
          <View style={styles.emptyIcon}><BthwaniIcon name="orders" color={theme.interactiveText} size={sizing.iconXl} /></View>
          <Text style={styles.cardTitle}>لا توجد طلبات بعد</Text>
          <Text style={styles.muted}>عندما تنشئ طلبًا سيظهر هنا مع حالته وتفاصيله.</Text>
          <BthwaniButton label="استكشف المتاجر" onPress={() => router.push("/home" as Href)} />
        </BthwaniSurface>
      ) : visibleOrders.length === 0 ? (
        <BthwaniSurface tone="inset" style={styles.emptyState}>
          <View style={styles.emptyIcon}><BthwaniIcon name="orders" color={theme.interactiveText} size={sizing.iconXl} /></View>
          <Text style={styles.cardTitle}>لا توجد طلبات بهذا النوع</Text>
          <BthwaniButton label="عرض كل الطلبات" onPress={() => setFulfillmentFilter("all")} variant="secondary" />
        </BthwaniSurface>
      ) : (
        <View style={styles.list}>
          {visibleOrders.map((order) => <View key={order.id} style={styles.order}>
            <Pressable accessibilityRole="button" accessibilityLabel={`قراءة الطلب من ${order.storeName} بتاريخ ${formatOrderDate(order.createdAt)}`} onPress={() => router.push(`/orders/${encodeURIComponent(order.id)}` as Href)} style={({ pressed }) => [styles.orderLink, pressed && styles.pressed]}>
              <View style={styles.orderTop}><View style={styles.orderTitleBlock}><Text style={styles.orderTitle}>طلب {formatOrderDate(order.createdAt)}</Text><Text style={styles.orderAddress} numberOfLines={1}>{order.fulfillmentMode === "CUSTOMER_PICKUP" ? `${fulfillmentModeLabel(order.fulfillmentMode)} · ${order.storeName}` : order.addressText}</Text></View><View style={styles.statusPill}><Text style={styles.statusText}>{orderStateLabel(order.state)}</Text></View></View>
              <View style={styles.orderBottom}><View style={styles.orderMetaBlock}><Text style={styles.orderMeta}>{order.lines.length} {order.lines.length === 1 ? "منتج" : "منتجات"}</Text><Text style={styles.orderPayment}>{paymentStateLabel(order.paymentState, order.paymentMethod, order.fulfillmentMode)}</Text></View><Text style={styles.orderTotal}>{formatMoney(order.totalAmountMinor, order.currency)}</Text><BthwaniIcon name="forward" color={theme.colorMuted} size={sizing.iconMd} /></View>
            </Pressable>
            {order.state === "DELIVERED" || order.state === "PICKED_UP" ? <BthwaniButton accessibilityLabel={`تكرار طلب ${order.storeName}`} busy={repeatingOrderID === order.id} disabled={Boolean(repeatingOrderID)} label="تكرار الطلب" onPress={() => void repeatOrder(order)} variant="secondary" /> : null}
          </View>)}
        </View>
      )}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, flexGrow: 1, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.hero, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    headingRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    headingCopy: { flex: 1, gap: spacing[1] },
    filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    error: { ...typography.bodySm, color: theme.danger },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    emptyState: { alignItems: "center", borderRadius: radius.xl, gap: spacing[3], padding: spacing[5] },
    emptyIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    cardTitle: { ...typography.titleSm, color: theme.color, textAlign: "center" },
    list: { gap: spacing[3] },
    order: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4], ...elevation.raised },
    orderLink: { gap: spacing[3] },
    orderTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    orderTitleBlock: { flex: 1, gap: spacing[1] },
    orderTitle: { ...typography.titleSm, color: theme.color },
    orderAddress: { ...typography.caption, color: theme.colorMuted },
    statusPill: { backgroundColor: theme.actionSoft, borderRadius: radius.round, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    statusText: { ...typography.caption, color: theme.interactiveText, textAlign: "center" },
    orderBottom: { alignItems: "center", borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", gap: spacing[2], paddingTop: spacing[3] },
    orderMeta: { ...typography.bodySm, color: theme.colorMuted, flex: 1 },
    orderMetaBlock: { flex: 1, gap: spacing[1] },
    orderPayment: { ...typography.caption, color: theme.interactiveText },
    orderTotal: { ...typography.bodyStrong, color: theme.color },
    pressed: { opacity: opacity.subtle },
  });
}

function sameIDs(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}
