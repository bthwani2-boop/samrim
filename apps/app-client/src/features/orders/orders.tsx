import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, formatOrderDate, fulfillmentModeLabel, paymentStateLabel, type Cart, type Order, orderStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { ClientOpenCarts } from "./client-open-carts";
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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [activeTab, setActiveTab] = useState<"orders" | "carts">("orders");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "delivery" | "pickup">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed" | "stopped">("all");
  const [repeatingOrderID, setRepeatingOrderID] = useState("");
  const [repeatError, setRepeatError] = useState("");

  const load = useCallback(async (preserveCurrent = false) => {
    const sequence = ++loadSequence.current;
    pageSequence.current += 1;
    setLoadingMore(false);
    setLoadMoreError("");
    const session = currentIdentityState();
    if (session.kind !== "authenticated" || !session.identity.subject.trim()) { setState({ kind: "auth_required" }); return; }
    const actorID = session.identity.subject.trim();
    if (preserveCurrent) setRefreshing(true);
    else setState({ kind: "loading" });
    setRefreshError("");
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
      if (preserveCurrent) setRefreshError("تعذر تحديث الطلبات. أعد القراءة قبل تنفيذ أي إجراء.");
      else setState({ kind: "error" });
    } finally {
      if (sequence === loadSequence.current) setRefreshing(false);
    }
  }, []);

  const visibleOrders = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.orders.filter((order) => {
      const byMode = fulfillmentFilter === "all" || (fulfillmentFilter === "pickup" ? order.fulfillmentMode === "CUSTOMER_PICKUP" : order.fulfillmentMode !== "CUSTOMER_PICKUP");
      const completed = order.state === "DELIVERED" || order.state === "PICKED_UP";
      const stopped = order.state === "REJECTED" || order.state === "CANCELLED" || order.state === "DELIVERY_FAILED";
      const byStatus = statusFilter === "all" || (statusFilter === "completed" ? completed : statusFilter === "stopped" ? stopped : !completed && !stopped);
      return byMode && byStatus;
    });
  }, [fulfillmentFilter, state, statusFilter]);

  const loadMore = useCallback(async () => {
    if (state.kind !== "ready" || !state.nextCursor || loadingMore || refreshing || !isClientActorScopeCurrent(state.actorID, activeActorID) || !hasCurrentOrdersActor(state.actorID)) return;
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
  }, [state, loadingMore, refreshing, activeActorID]);

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

  useEffect(() => {
    if (!activeActorID) {
      loadSequence.current += 1;
      setState({ kind: "auth_required" });
      setRefreshError("");
      return;
    }
    void load();
  }, [activeActorID, load]);

  if (state.kind === "ready" && !isClientActorScopeCurrent(state.actorID, activeActorID)) {
    return <View style={styles.state} accessibilityLabel="جارٍ التحقق من صاحب الطلبات"><BthwaniSkeleton height={112} /><Text style={styles.muted}>جارٍ التحقق من الجلسة وملكية الطلبات…</Text></View>;
  }
  if (state.kind === "auth_required") {
    return <View style={styles.state}><BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>سجّل الدخول لمتابعة طلباتك</Text><Text style={styles.muted}>ستظهر طلباتك وحالاتها هنا بعد تسجيل الدخول.</Text><BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/orders" as Href)} /></View>;
  }
  if (activeTab === "carts" && activeActorID) {
    return <View style={styles.container} accessibilityLabel="سلال العميل">
      <Text style={styles.eyebrow}>متابعة رحلتك</Text>
      <Text style={styles.title}>طلباتي وسلالي</Text>
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
      <Text style={styles.eyebrow}>متابعة رحلتك</Text>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}><Text style={styles.title}>طلباتي</Text><Text style={styles.muted}>تابع حالة طلباتك وافتح أي طلب لمراجعة التفاصيل الحالية.</Text></View>
        <BthwaniButton accessibilityLabel="تحديث قائمة الطلبات" busy={refreshing} label="تحديث" onPress={() => void load(true)} variant="secondary" />
      </View>
      <View style={styles.filterRow} accessibilityLabel="التبديل بين الطلبات والسلال">
        <BthwaniChip label="طلباتي" selected onPress={() => {}} />
        <BthwaniChip label="سلالي" selected={false} onPress={() => setActiveTab("carts")} />
      </View>
      {refreshError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{refreshError}</Text> : null}
      <View accessibilityLabel="تصفية الطلبات حسب طريقة الاستلام" style={styles.filterRow}>
        <BthwaniChip label="الكل" selected={fulfillmentFilter === "all"} onPress={() => setFulfillmentFilter("all")} />
        <BthwaniChip label="التوصيل" selected={fulfillmentFilter === "delivery"} onPress={() => setFulfillmentFilter("delivery")} />
        <BthwaniChip label="الاستلام من المتجر" selected={fulfillmentFilter === "pickup"} onPress={() => setFulfillmentFilter("pickup")} />
      </View>
      <View accessibilityLabel="تصفية الطلبات حسب الحالة" style={styles.filterRow}>
        <BthwaniChip label="كل الحالات" selected={statusFilter === "all"} onPress={() => setStatusFilter("all")} />
        <BthwaniChip label="قيد التنفيذ" selected={statusFilter === "active"} onPress={() => setStatusFilter("active")} />
        <BthwaniChip label="مكتملة" selected={statusFilter === "completed"} onPress={() => setStatusFilter("completed")} />
        <BthwaniChip label="ملغاة أو متعثرة" selected={statusFilter === "stopped"} onPress={() => setStatusFilter("stopped")} />
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
          <BthwaniButton label="عرض كل الطلبات" onPress={() => { setFulfillmentFilter("all"); setStatusFilter("all"); }} variant="secondary" />
        </BthwaniSurface>
      ) : (
        <View style={styles.list}>
          {visibleOrders.map((order) => <View key={order.id} style={styles.order}>
            <Pressable accessibilityRole="button" accessibilityLabel={`قراءة الطلب من ${order.storeName} بتاريخ ${formatOrderDate(order.createdAt)}`} onPress={() => router.push(`/orders/${encodeURIComponent(order.id)}` as Href)} style={({ pressed }) => [styles.orderLink, pressed && styles.pressed]}>
              <View style={styles.orderTop}><View style={styles.orderTitleBlock}><Text style={styles.orderTitle}>طلب {formatOrderDate(order.createdAt)}</Text><Text style={styles.orderAddress} numberOfLines={1}>{order.fulfillmentMode === "CUSTOMER_PICKUP" ? `${fulfillmentModeLabel(order.fulfillmentMode)} · ${order.storeName}` : order.addressText}</Text></View><View style={styles.statusPill}><Text style={styles.statusText}>{orderStateLabel(order.state)}</Text></View></View>
              <View style={styles.orderBottom}><View style={styles.orderMetaBlock}><Text style={styles.orderMeta}>{order.lines.length} {order.lines.length === 1 ? "منتج" : "منتجات"}</Text><Text style={styles.orderPayment}>{paymentStateLabel(order.paymentState, order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)}</Text></View><Text style={styles.orderTotal}>{formatMoney(order.totalAmountMinor, order.currency)}</Text><BthwaniIcon name="forward" color={theme.colorMuted} size={sizing.iconMd} /></View>
            </Pressable>
            {order.state === "DELIVERED" || order.state === "PICKED_UP" ? <BthwaniButton accessibilityLabel={`تكرار طلب ${order.storeName}`} busy={repeatingOrderID === order.id} disabled={Boolean(repeatingOrderID)} label="تكرار الطلب" onPress={() => void repeatOrder(order)} variant="secondary" /> : null}
          </View>)}
        </View>
      )}
      {state.nextCursor ? <View style={styles.list}>
        {loadMoreError ? <Text accessibilityRole="alert" style={styles.error}>{loadMoreError}</Text> : null}
        <BthwaniButton busy={loadingMore} disabled={refreshing || loadingMore || Boolean(repeatingOrderID)} label={loadingMore ? "جارٍ تحميل الطلبات الأقدم…" : "عرض طلبات أقدم"} onPress={() => void loadMore()} variant="secondary" />
      </View> : null}
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
