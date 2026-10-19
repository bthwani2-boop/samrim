import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, formatOrderDate, fulfillmentModeLabel, orderPaymentDisclosure, paymentStateLabel, type Cart, type Order, orderStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { ClientOpenCarts } from "./client-open-carts";
import { matchesOrderFilters } from "./order-list-filter";
import { isClientActorScopeCurrent } from "./order-session-scope";

type OrdersState = { kind: "loading" } | { kind: "ready"; orders: ReadonlyArray<Order>; actorID: string; nextCursor: string } | { kind: "error" } | { kind: "auth_required" };

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

function hasCurrentOrdersActor(actorID: string): boolean {
  const session = currentIdentityState();
  return session.kind === "authenticated" && isClientActorScopeCurrent(actorID, session.identity.subject.trim());
}

export default function ClientOrders() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<OrdersState>({ kind: "loading" });
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const loadSequence = useRef(0);
  const pageSequence = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [activeTab, setActiveTab] = useState<"orders" | "carts">("orders");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "delivery" | "pickup">("all");
  const [repeatingOrderID, setRepeatingOrderID] = useState("");
  const [repeatError, setRepeatError] = useState("");

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    pageSequence.current += 1;
    setLoadingMore(false);
    setLoadMoreError("");
    const session = currentIdentityState();
    if (session.kind !== "authenticated" || !session.identity.subject.trim()) { setState({ kind: "auth_required" }); return; }
    const actorID = session.identity.subject.trim();
    setState({ kind: "loading" });
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await client().listClientOrders(token, 50);
      const current = currentIdentityState();
      if (sequence !== loadSequence.current || current.kind !== "authenticated" || !isClientActorScopeCurrent(actorID, current.identity.subject.trim())) return;
      setState({ kind: "ready", orders: response.orders, actorID, nextCursor: response.nextCursor ?? "" });
    } catch (error) {
      console.error("DSH client orders read failed", error);
      const current = currentIdentityState();
      if (sequence !== loadSequence.current || current.kind !== "authenticated" || !isClientActorScopeCurrent(actorID, current.identity.subject.trim())) return;
      setState({ kind: "error" });
    }
  }, []);

  const visibleOrders = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.orders.filter((order) => matchesOrderFilters(order, fulfillmentFilter));
  }, [fulfillmentFilter, state]);

  const loadMore = useCallback(async () => {
    if (state.kind !== "ready" || !state.nextCursor || loadingMore || !isClientActorScopeCurrent(state.actorID, activeActorID) || !hasCurrentOrdersActor(state.actorID)) return;
    const sequence = ++pageSequence.current;
    const loadID = loadSequence.current;
    const cursor = state.nextCursor;
    const actorID = state.actorID;
    setLoadMoreError("");
    setLoadingMore(true);
    try {
      const token = await getUsableIdentityAccessToken();
      if (sequence !== pageSequence.current || loadID !== loadSequence.current || !hasCurrentOrdersActor(actorID)) return;
      const response = await client().listClientOrders(token, 50, "", cursor);
      if (sequence !== pageSequence.current || loadID !== loadSequence.current || !hasCurrentOrdersActor(actorID)) return;
      setState((current) => {
        if (current.kind !== "ready" || current.actorID !== actorID || current.nextCursor !== cursor) return current;
        const existingIDs = new Set(current.orders.map((item) => item.id));
        return { ...current, orders: [...current.orders, ...response.orders.filter((item) => !existingIDs.has(item.id))], nextCursor: response.nextCursor && response.nextCursor !== cursor ? response.nextCursor : "" };
      });
    } catch (error) {
      console.error("DSH client orders next-page read failed", error);
      if (sequence === pageSequence.current && loadID === loadSequence.current && hasCurrentOrdersActor(actorID)) setLoadMoreError("تعذر تحميل الطلبات الأقدم. أعد المحاولة.");
    } finally {
      if (sequence === pageSequence.current && loadID === loadSequence.current && hasCurrentOrdersActor(actorID)) setLoadingMore(false);
    }
  }, [state, loadingMore, activeActorID]);

  const repeatOrder = useCallback(async (order: Order) => {
    if (state.kind !== "ready" || !isClientActorScopeCurrent(state.actorID, activeActorID) || !hasCurrentOrdersActor(state.actorID) || repeatingOrderID || !order.lines.length) return;
    const actorID = state.actorID;
    setRepeatingOrderID(order.id);
    setRepeatError("");
    let appliedCount = 0;
    try {
      const token = await getUsableIdentityAccessToken();
      if (!hasCurrentOrdersActor(actorID)) return;
      let cart: Cart | null = null;
      try {
        cart = (await client().readOpenCart(token, order.storeId)).cart;
      } catch (error) {
        const missingCart = typeof error === "object" && error !== null && "kind" in error && (error as { kind?: unknown }).kind === "http" && "status" in error && (error as { status?: unknown }).status === 404;
        if (!missingCart) throw error;
      }

      if (!hasCurrentOrdersActor(actorID)) return;
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
        if (!hasCurrentOrdersActor(actorID)) return;
        const response = await client().upsertCartLine(token, {
          storeId: order.storeId,
          storeOfferId: item.storeOfferId,
          quantityBaseUnits: item.quantityBaseUnits,
          selectedModifierOptionIds: item.selectedModifierOptionIds,
        }, expectedVersion);
        expectedVersion = response.cart.version;
        appliedCount += 1;
      }
      if (!hasCurrentOrdersActor(actorID)) return;
      router.push(`/cart/${encodeURIComponent(order.storeId)}?fulfillmentMode=${encodeURIComponent(order.fulfillmentMode)}` as Href);
    } catch (error) {
      console.error("DSH client order repeat failed", error);
      if (!hasCurrentOrdersActor(actorID)) return;
      setRepeatError(appliedCount ? `تعذر إكمال التكرار؛ أُضيف ${appliedCount} من ${order.lines.length} منتجات. راجع السلة قبل المتابعة.` : "تعذر تكرار الطلب. قد يتغير توفر المنتجات أو خياراتها؛ حدّث القائمة وحاول مجددًا.");
    } finally {
      setRepeatingOrderID("");
    }
  }, [activeActorID, repeatingOrderID, router, state]);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);

  useFocusEffect(useCallback(() => {
    if (!activeActorID) {
      loadSequence.current += 1;
      pageSequence.current += 1;
      setState({ kind: "auth_required" });
    } else {
      void load();
    }
    return () => {
      loadSequence.current += 1;
      pageSequence.current += 1;
    };
  }, [activeActorID, load]));

  if (state.kind === "ready" && !isClientActorScopeCurrent(state.actorID, activeActorID)) {
    return <View style={styles.state} accessibilityLabel="جارٍ التحقق من صاحب الطلبات"><BthwaniSkeleton height={112} /><Text style={styles.muted}>جارٍ التحقق من الجلسة وملكية الطلبات…</Text></View>;
  }
  if (state.kind === "auth_required") {
    return <View style={styles.state}><BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>سجّل الدخول لمتابعة طلباتك</Text><Text style={styles.muted}>ستظهر طلباتك وحالاتها هنا بعد تسجيل الدخول.</Text><BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/orders" as Href)} /></View>;
  }
  if (activeTab === "carts" && activeActorID) {
    return <View style={styles.container} accessibilityLabel="سلال العميل">
      <View style={styles.filterRow} accessibilityLabel="التبديل بين الطلبات والسلال">
        <BthwaniChip label="طلباتي" selected={false} onPress={() => setActiveTab("orders")} />
        <BthwaniChip label="سلالي" selected onPress={() => {}} />
      </View>
      <ClientOpenCarts actorID={activeActorID} />
    </View>;
  }
  if (state.kind === "loading") {
    return <View style={styles.state} accessibilityLabel="جارٍ تجهيز الطلبات"><BthwaniSkeleton width="42%" height={28} /><BthwaniSkeleton height={112} /><BthwaniSkeleton height={112} /></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر قراءة الطلبات</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View>;
  }

  return (
    <View style={styles.container} accessibilityLabel="طلبات العميل">
      <View style={styles.filterRow} accessibilityLabel="التبديل بين الطلبات والسلال">
        <BthwaniChip label="طلباتي" selected onPress={() => {}} />
        <BthwaniChip label="سلالي" selected={false} onPress={() => setActiveTab("carts")} />
      </View>
      <View accessibilityLabel="تصفية الطلبات حسب طريقة الاستلام" style={styles.filterRow}>
        <BthwaniChip label="كل الطرق" selected={fulfillmentFilter === "all"} onPress={() => setFulfillmentFilter("all")} />
        <BthwaniChip label="توصيل" selected={fulfillmentFilter === "delivery"} onPress={() => setFulfillmentFilter("delivery")} />
        <BthwaniChip label="استلام من المتجر" selected={fulfillmentFilter === "pickup"} onPress={() => setFulfillmentFilter("pickup")} />
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
          <Text style={styles.cardTitle}>{state.nextCursor ? "لا توجد طلبات مطابقة في الصفحات المحمّلة" : "لا توجد طلبات بهذا النوع"}</Text>
          {state.nextCursor ? <Text style={styles.muted}>قد تجد طلبات مطابقة في الصفحات الأقدم. استخدم «البحث في طلبات أقدم» لمتابعة السجل.</Text> : null}
          <BthwaniButton label="عرض كل الطلبات" onPress={() => setFulfillmentFilter("all")} variant="secondary" />
        </BthwaniSurface>
      ) : (
        <View style={styles.list}>
          {visibleOrders.map((order) => <View key={order.id} style={styles.order}>
            <Pressable accessibilityRole="button" accessibilityLabel={`تفاصيل طلب ${order.storeName}، ${orderStateLabel(order.state)}`} onPress={() => router.push(`/orders/${encodeURIComponent(order.id)}` as Href)} style={({ pressed }) => [styles.orderLink, pressed && styles.pressed]}>
              <View style={styles.orderTop}>
                <View style={styles.orderTitleBlock}>
                  <Text style={styles.orderTitle} numberOfLines={1}>{order.storeName}</Text>
                  <Text style={styles.orderDate}>{formatOrderDate(order.createdAt)}</Text>
                </View>
                <View style={styles.statusPill}>
                  <Text style={[styles.statusText, (order.state === "DELIVERED" || order.state === "PICKED_UP") && styles.statusSuccess, (order.state === "CANCELLED" || order.state === "REJECTED" || order.state === "DELIVERY_FAILED") && styles.statusStopped]}>{orderStateLabel(order.state)}</Text>
                </View>
              </View>
              <Text style={styles.orderMeta}>{fulfillmentModeLabel(order.fulfillmentMode)} · {order.lines.length} {order.lines.length === 1 ? "منتج" : "منتجات"}</Text>
              <View style={styles.orderBottom}>
                <View style={styles.priceBlock}>
                  <Text style={styles.priceLabel}>{order.state === "CANCELLED" || order.state === "REJECTED" ? "الإجمالي السابق" : "إجمالي الطلب"}</Text>
                  <Text style={styles.orderTotal}>{formatMoney(order.totalAmountMinor, order.currency)}</Text>
                </View>
                <View style={styles.orderMetaBlock}>
                  <Text style={styles.orderPayment} numberOfLines={2}>{order.state === "CANCELLED" || order.state === "REJECTED" ? orderPaymentDisclosure(order).status : paymentStateLabel(order.paymentState, order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)}</Text>
                  <View style={styles.detailsHint}><Text style={styles.detailsText}>التفاصيل</Text><BthwaniIcon name="forward" color={theme.interactiveText} size={sizing.iconSm} /></View>
                </View>
              </View>
            </Pressable>
            {(order.state === "DELIVERED" || order.state === "PICKED_UP") && order.lines.length > 0 ? <BthwaniButton accessibilityLabel={`تكرار طلب ${order.storeName}`} busy={repeatingOrderID === order.id} disabled={Boolean(repeatingOrderID)} label="إعادة الطلب" onPress={() => void repeatOrder(order)} style={styles.repeatButton} variant="quiet" /> : null}
          </View>)}
        </View>
      )}
      {state.nextCursor ? <View style={styles.list}>
        {loadMoreError ? <Text accessibilityRole="alert" style={styles.error}>{loadMoreError}</Text> : null}
        <BthwaniButton busy={loadingMore} disabled={loadingMore || Boolean(repeatingOrderID)} label={loadingMore ? "جارٍ تحميل الطلبات الأقدم…" : visibleOrders.length === 0 && state.orders.length > 0 ? "البحث في طلبات أقدم" : "عرض طلبات أقدم"} onPress={() => void loadMore()} variant="secondary" />
      </View> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, flexGrow: 1, gap: spacing[3], paddingBottom: spacing[5], width: "100%" },
    title: { ...typography.titleLg, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[1] },
    error: { ...typography.bodySm, color: theme.danger },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    emptyState: { alignItems: "center", borderRadius: radius.xl, gap: spacing[3], padding: spacing[5] },
    emptyIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    cardTitle: { ...typography.titleSm, color: theme.color, textAlign: "center" },
    list: { gap: spacing[2] },
    order: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3], ...elevation.raised },
    orderLink: { gap: spacing[2] },
    orderTop: { alignItems: "center", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    orderTitleBlock: { flex: 1, gap: spacing[1] },
    orderTitle: { ...typography.titleSm, color: theme.color },
    orderDate: { ...typography.caption, color: theme.colorMuted },
    statusPill: { backgroundColor: theme.actionSoft, borderRadius: radius.round, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    statusText: { ...typography.caption, color: theme.interactiveText, textAlign: "center" },
    statusSuccess: { color: theme.success },
    statusStopped: { color: theme.danger },
    orderBottom: { alignItems: "center", borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", paddingTop: spacing[2] },
    orderMeta: { ...typography.bodySm, color: theme.colorMuted },
    orderMetaBlock: { alignItems: "flex-end", flex: 1, gap: spacing[1] },
    priceBlock: { gap: spacing[1] },
    detailsHint: { alignItems: "center", flexDirection: "row", gap: spacing[1], minHeight: spacing[6] },
    detailsText: { ...typography.label, color: theme.interactiveText },
    repeatButton: { alignSelf: "flex-end", minHeight: 44 },
    priceLabel: { ...typography.caption, color: theme.colorMuted },
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
