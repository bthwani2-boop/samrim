import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniSkeleton, BthwaniSurface, useOrderChatUnreadCounts, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, formatOrderDate, fulfillmentModeLabel, orderPaymentDisclosure, paymentStateLabel, type Cart, type Order, type PublicStoreView, orderStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { PremiumOrderProgress, PremiumStoreIdentity, premiumColors } from "../order-experience/premium-order-ui";
import { orderJourneyPresentation } from "./order-journey";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { isPartialOrderListEmpty, matchesOrderFilters, matchesOrderStatus, type OrderFulfillmentFilter } from "./order-list-filter";
import { isClientActorScopeCurrent } from "./order-session-scope";
import { acquireRepeatOrder, createRepeatOrderGate, invalidateRepeatOrderForActorChange, ownsRepeatOrder, releaseRepeatOrder } from "./repeat-order-gate";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const statusOptions = [
  { key: "all", label: "الكل" },
  { key: "active", label: "نشطة" },
  { key: "completed", label: "مكتملة" },
  { key: "cancelled", label: "ملغاة" },
] as const;

const fulfillmentOptions = [
  { key: "all", label: "كل الطرق" },
  { key: "bthwani", label: "توصيل بثواني" },
  { key: "store", label: "توصيل المتجر" },
  { key: "pickup", label: "استلم بنفسك" },
] as const;

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
  const ordersFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const theme = useAppearanceTheme();
  const premium = premiumColors(theme);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<OrdersState>({ kind: "loading" });
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const loadSequence = useRef(0);
  const pageSequence = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed" | "cancelled">("all");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [storeIdentity, setStoreIdentity] = useState<Readonly<Record<string, PublicStoreView>>>({});
  const [fulfillmentFilter, setFulfillmentFilter] = useState<OrderFulfillmentFilter>("all");
  const [repeatingOrderID, setRepeatingOrderID] = useState("");
  const [repeatError, setRepeatError] = useState("");
  const repeatOrderGate = useRef(createRepeatOrderGate());
  const selectedStatusLabel = statusOptions.find((option) => option.key === statusFilter)?.label ?? "الكل";
  const selectedFulfillmentLabel = fulfillmentOptions.find((option) => option.key === fulfillmentFilter)?.label ?? "كل الطرق";
  const filterButtonLabel = statusFilter !== "all" ? selectedStatusLabel : fulfillmentFilter !== "all" ? selectedFulfillmentLabel : "تصفية";
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
    return state.orders.filter((order) => {
      if (!matchesOrderFilters(order, fulfillmentFilter)) return false;
      if (!matchesOrderStatus(order.state, statusFilter)) return false;
      const q = search.trim().toLocaleLowerCase("ar");
      return !q || order.storeName.toLocaleLowerCase("ar").includes(q) || order.id.toLowerCase().includes(q);
    });
  }, [fulfillmentFilter, statusFilter, search, state]);
  const partialEmpty = state.kind === "ready" && isPartialOrderListEmpty(visibleOrders.length, state.nextCursor);
  const emptyStateTitle = partialEmpty ? "\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0637\u0627\u0628\u0642\u0629 \u0636\u0645\u0646 \u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0645\u062d\u0645\u0651\u0644\u0629"
    : search.trim() || fulfillmentFilter !== "all" ? "\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0637\u0627\u0628\u0642\u0629"
    : statusFilter === "cancelled" ? "\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0644\u063a\u0627\u0629"
    : statusFilter === "completed" ? "\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0643\u062a\u0645\u0644\u0629"
    : statusFilter === "active" ? "\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0646\u0634\u0637\u0629"
    : state.kind === "ready" && state.orders.length === 0 ? "\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0628\u0639\u062f" : "\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0637\u0627\u0628\u0642\u0629";

  const getChatUnread = useCallback(async (orderId: string) => {
    const token = await getUsableIdentityAccessToken();
    return (await client().readOrderConversation(token, orderId, 1)).unreadCount;
  }, []);
  const unreadChatCounts = useOrderChatUnreadCounts(visibleOrders.map(order => order.id), activeActorID, ordersFocused, getChatUnread);

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
    if (state.kind !== "ready" || !isClientActorScopeCurrent(state.actorID, activeActorID) || !hasCurrentOrdersActor(state.actorID) || !order.lines.length) return;
    const actorID = state.actorID;
    const lease = acquireRepeatOrder(repeatOrderGate.current, actorID, order.id);
    if (!lease) return;
    setRepeatingOrderID(order.id);
    setRepeatError("");
    let appliedCount = 0;
    try {
      const token = await getUsableIdentityAccessToken();
      if (!ownsRepeatOrder(repeatOrderGate.current, lease) || !hasCurrentOrdersActor(actorID)) return;
      let cart: Cart | null = null;
      try {
        cart = (await client().readOpenCart(token, order.storeId)).cart;
      } catch (error) {
        const missingCart = typeof error === "object" && error !== null && "kind" in error && (error as { kind?: unknown }).kind === "http" && "status" in error && (error as { status?: unknown }).status === 404;
        if (!missingCart) throw error;
      }

      if (!ownsRepeatOrder(repeatOrderGate.current, lease) || !hasCurrentOrdersActor(actorID)) return;
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
        if (!ownsRepeatOrder(repeatOrderGate.current, lease) || !hasCurrentOrdersActor(actorID)) return;
        const response = await client().upsertCartLine(token, {
          storeId: order.storeId,
          storeOfferId: item.storeOfferId,
          quantityBaseUnits: item.quantityBaseUnits,
          selectedModifierOptionIds: item.selectedModifierOptionIds,
        }, expectedVersion);
        expectedVersion = response.cart.version;
        appliedCount += 1;
      }
      if (!ownsRepeatOrder(repeatOrderGate.current, lease) || !hasCurrentOrdersActor(actorID)) return;
      router.push(`/cart/${encodeURIComponent(order.storeId)}?fulfillmentMode=${encodeURIComponent(order.fulfillmentMode)}` as Href);
    } catch (error) {
      console.error("DSH client order repeat failed", error);
      if (!ownsRepeatOrder(repeatOrderGate.current, lease) || !hasCurrentOrdersActor(actorID)) return;
      setRepeatError(appliedCount ? `تعذر إكمال التكرار؛ أُضيف ${appliedCount} من ${order.lines.length} منتجات. راجع السلة قبل المتابعة.` : "تعذر تكرار الطلب. قد يتغير توفر المنتجات أو خياراتها؛ حدّث القائمة وحاول مجددًا.");
    } finally {
      if (releaseRepeatOrder(repeatOrderGate.current, lease)) {
        setRepeatingOrderID((current) => repeatOrderGate.current.current === null && current === order.id ? "" : current);
      }
    }
  }, [activeActorID, router, state]);

  useEffect(() => subscribeIdentitySession((next) => {
    const nextActorID = next.kind === "authenticated" ? next.identity.subject.trim() : "";
    const invalidated = invalidateRepeatOrderForActorChange(repeatOrderGate.current, nextActorID);
    if (invalidated) {
      setRepeatingOrderID((current) => repeatOrderGate.current.current === null && current === invalidated.orderID ? "" : current);
    }
    setIdentityState(next);
  }), []);
  useEffect(() => {
    if (state.kind !== "ready" || !hasCurrentOrdersActor(state.actorID)) {
      setStoreIdentity({});
      return;
    }
    let live = true;
    const actorID = state.actorID;
    const uniqueStores = [...new Map(state.orders.slice(0, 12).map((order) => [order.storeId, { storeId: order.storeId, cityId: order.serviceCityId }])).values()];
    void Promise.all(uniqueStores.map(async ({ storeId, cityId }) => {
      try { return [storeId, await client().readPublishedStore(storeId, cityId)] as const; }
      catch { return null; }
    })).then((results) => {
      if (live && hasCurrentOrdersActor(actorID)) setStoreIdentity(Object.fromEntries(results.filter((result): result is readonly [string, PublicStoreView] => result !== null)));
    });
    return () => { live = false; };
  }, [state]);

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
  if (state.kind === "loading") {
    return <View style={styles.state} accessibilityLabel="جارٍ تجهيز الطلبات"><BthwaniSkeleton width="42%" height={28} /><BthwaniSkeleton height={112} /><BthwaniSkeleton height={112} /></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر قراءة الطلبات</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View>;
  }

  return <View style={styles.container} accessibilityLabel="طلباتي">
    <View style={styles.ordersHeader}><Text style={styles.screenTitle}>طلباتي</Text><Pressable accessibilityRole="button" accessibilityLabel="الرجوع" style={styles.backAction} onPress={() => router.back()}><BthwaniIcon name="back" color={premium.text} size={24} /></Pressable></View>
    <View style={styles.searchRow}>
      <Pressable style={[styles.filterButton, (statusFilter !== "all" || fulfillmentFilter !== "all") && styles.filterButtonActive]}
        accessibilityRole="button" accessibilityLabel={`تصفية الطلبات: ${selectedStatusLabel}، ${selectedFulfillmentLabel}`}
        accessibilityState={{ expanded: filtersOpen }}
        onPress={() => { Keyboard.dismiss(); setFiltersOpen(true); }}>
        <Text numberOfLines={1} style={styles.filterLabel}>{filterButtonLabel}</Text>
        <View style={[styles.filterIndicator, (statusFilter !== "all" || fulfillmentFilter !== "all") && styles.filterIndicatorActive]} />
      </Pressable>
      <TextInput accessibilityLabel="البحث في طلباتي" style={styles.searchInput} placeholder="ابحث في طلباتك..." placeholderTextColor={premium.muted}
        value={search} onChangeText={setSearch} />
    </View>
    {repeatError ? <Text accessibilityRole="alert" style={styles.error}>{repeatError}</Text> : null}
    {visibleOrders.length === 0 ? <BthwaniSurface tone="raised" style={styles.emptyState}>
      <BthwaniIcon name="orders" color={premium.orange} size={sizing.iconXl} />
      <Text style={styles.cardTitle}>{emptyStateTitle}</Text>
      <Text style={styles.muted}>{partialEmpty ? "\u0642\u062f \u062a\u062d\u062a\u0648\u064a \u0627\u0644\u0635\u0641\u062d\u0627\u062a \u0627\u0644\u0623\u0642\u062f\u0645 \u0639\u0644\u0649 \u0646\u062a\u0627\u0626\u062c. \u062d\u0645\u0651\u0644 \u0627\u0644\u0645\u0632\u064a\u062f \u0644\u0645\u062a\u0627\u0628\u0639\u0629 \u0627\u0644\u0628\u062d\u062b." : state.orders.length === 0 && statusFilter === "all" && fulfillmentFilter === "all" && !search.trim() ? "ستظهر طلباتك هنا بعد تأكيدها." : "جرّب تغيير البحث أو التصفية."}</Text>
      <BthwaniButton label={state.orders.length === 0 && !state.nextCursor ? "استكشف المتاجر" : "عرض الكل"} onPress={() => state.orders.length === 0 && !state.nextCursor ? router.push("/home" as Href) : (setSearch(""), setStatusFilter("all"), setFulfillmentFilter("all"))} />
    </BthwaniSurface> : <View style={styles.list}>
      {visibleOrders.map((order) => {
        const journey = orderJourneyPresentation(order);
        const image = storeIdentity[order.storeId];
        const ended = ["DELIVERED", "PICKED_UP", "CANCELLED", "REJECTED", "DELIVERY_FAILED"].includes(order.state);
        return <BthwaniSurface key={order.id} tone="raised" style={styles.order}>
          <Pressable accessibilityRole="button" accessibilityLabel={"متابعة طلب " + order.storeName} onPress={() => router.push(("/orders/" + encodeURIComponent(order.id)) as Href)}>
            <PremiumStoreIdentity title={order.storeName} compact imageUri={image?.storeCoverImage?.uri ?? image?.storeProfileImage?.uri}
              subtitle={image?.addressLine || fulfillmentModeLabel(order.fulfillmentMode)}
              rating={image && image.ratingCount > 0 ? image.ratingAverage.toFixed(1) : undefined}/>
          </Pressable>
          <View style={styles.statusRow}><Text style={styles.modeText}>{journey.fulfillmentLabel}</Text>
            <Text style={[styles.statusHeadline, journey.exception && styles.statusDanger]}>{journey.title}</Text>
          </View>
          {!journey.exception ? <PremiumOrderProgress steps={journey.steps} index={journey.currentStep} /> : null}
          <View style={styles.orderBottom}>
            <View style={styles.orderData}>
              <Text style={styles.muted}>{formatOrderDate(order.createdAt)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={"محادثة الطلب "+order.id.slice(-8)}
                onPress={()=>router.push(("/orders/"+encodeURIComponent(order.id)+"?chat=1") as Href)}
                style={{alignSelf:"flex-start",paddingHorizontal:10,paddingVertical:5,borderRadius:12,backgroundColor:premium.soft}}>
                <Text style={{fontSize:18}}>💬</Text>
                {unreadChatCounts[order.id] ? <Text accessibilityLabel={unreadChatCounts[order.id]+" رسائل غير مقروءة"} style={{color:premium.orange,fontSize:10,fontWeight:"800"}}>{(unreadChatCounts[order.id] ?? 0)>99?"99+":unreadChatCounts[order.id]}</Text> : null}
              </Pressable>
              <Text numberOfLines={1} style={styles.orderId}>طلب #{order.id.slice(0, 8)}</Text>
            </View>
            <View style={styles.orderData}><Text style={styles.muted}>إجمالي الطلب</Text>
              <Text style={styles.orderTotal}>{formatMoney(order.totalAmountMinor, order.currency)}</Text></View>
            <View style={styles.trackButton}>
              <BthwaniButton label={ended ? "عرض التفاصيل" : "تتبع الطلب"} onPress={() => router.push(("/orders/" + encodeURIComponent(order.id)) as Href)} />
            </View>
          </View>
          {(order.state === "DELIVERED" || order.state === "PICKED_UP") && order.lines.length > 0
            ? <BthwaniButton accessibilityLabel={"إعادة طلب " + order.storeName} label="إعادة الطلب" variant="quiet"
                busy={repeatingOrderID === order.id} disabled={Boolean(repeatingOrderID)} onPress={() => void repeatOrder(order)} /> : null}
        </BthwaniSurface>;
      })}
    </View>}
    {state.nextCursor ? <View style={styles.list}>
      {loadMoreError ? <Text accessibilityRole="alert" style={styles.error}>{loadMoreError}</Text> : null}
      <BthwaniButton label="عرض طلبات أقدم" busy={loadingMore} disabled={loadingMore || Boolean(repeatingOrderID)} onPress={() => void loadMore()} variant="secondary" />
    </View> : null}
    <Modal visible={filtersOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setFiltersOpen(false)}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="إغلاق التصفية" onPress={() => setFiltersOpen(false)} />
        <View style={[styles.filterSheet, { paddingBottom: Math.max(insets.bottom, spacing[4]) }]} accessibilityViewIsModal>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>تصفية الطلبات</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="إغلاق التصفية" style={styles.sheetClose} onPress={() => setFiltersOpen(false)}>
              <BthwaniIcon name="close" size={20} color={premium.muted} />
            </Pressable>
          </View>
          <Text style={styles.sheetSectionTitle}>حالة الطلب</Text>
          <View style={styles.statusChoices}>
            {statusOptions.map(({ key, label }) => <Pressable key={key} accessibilityRole="radio"
              accessibilityState={{ checked: statusFilter === key }} accessibilityLabel={label}
              style={[styles.statusChoice, statusFilter === key && styles.statusChoiceActive]}
              onPress={() => { setStatusFilter(key); setFiltersOpen(false); }}>
              <Text style={[styles.statusChoiceLabel, statusFilter === key && styles.statusChoiceLabelActive]}>{label}</Text>
              <View style={[styles.statusRadio, statusFilter === key && styles.statusRadioActive]}>
                {statusFilter === key ? <View style={styles.statusRadioDot} /> : null}
              </View>
            </Pressable>)}
          </View>
          <Text style={styles.sheetSectionTitle}>طريقة الاستلام</Text>
          <View style={styles.fulfillmentChoices}>
            {fulfillmentOptions.map(({ key, label }) => <BthwaniChip key={key} label={label}
              selected={fulfillmentFilter === key} onPress={() => { setFulfillmentFilter(key); setFiltersOpen(false); }} />)}
          </View>
          {(statusFilter !== "all" || fulfillmentFilter !== "all") ? <Pressable accessibilityRole="button"
            style={styles.resetButton} onPress={() => { setStatusFilter("all"); setFulfillmentFilter("all"); setFiltersOpen(false); }}>
            <Text style={styles.resetLabel}>مسح التصفية</Text>
          </Pressable> : null}
        </View>
      </View>
    </Modal>
  </View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const premium = premiumColors(theme);
  return StyleSheet.create({
    container: { backgroundColor: premium.background, flexGrow: 1, gap: spacing[3], paddingHorizontal: spacing[2], paddingBottom: spacing[8], width: "100%" },
    ordersHeader: { flexDirection: "row", alignItems: "center", minHeight: 56 },
    backAction: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
    screenTitle: { ...typography.titleLg, color: premium.text, textAlign: "center", paddingVertical: spacing[3], flex: 1 },
    title: { ...typography.titleLg, color: theme.color },
    muted: { ...typography.bodySm, color: premium.muted, textAlign: "right" },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    searchRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    searchInput: { backgroundColor: premium.surface, borderRadius: 13, borderColor: premium.stroke, borderWidth: 1, color: premium.text, flex: 1, paddingHorizontal: 12, minHeight: 46, fontSize: 15 },
    filterButton: { minWidth: 86, maxWidth: 134, minHeight: 46, paddingHorizontal: spacing[3], flexDirection: "row", gap: spacing[2], alignItems: "center", justifyContent: "center", borderColor: premium.stroke, borderWidth: 1, borderRadius: 13 },
    filterButtonActive: { borderColor: premium.coral, backgroundColor: premium.soft },
    filterLabel: { ...typography.bodySm, color: premium.orange, fontWeight: "600", flexShrink: 1 },
    filterIndicator: { width: 8, height: 8, borderRadius: 4, borderColor: premium.muted, borderWidth: 1 },
    filterIndicatorActive: { backgroundColor: premium.orange, borderColor: premium.orange },
    modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.64)" },
    filterSheet: { maxHeight: "90%", backgroundColor: premium.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[2] },
    sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: premium.stroke, alignSelf: "center", marginBottom: spacing[2] },
    sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    sheetTitle: { ...typography.titleSm, color: premium.text },
    sheetClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    sheetSectionTitle: { ...typography.bodySm, fontWeight: "700", color: premium.muted, marginTop: spacing[2] },
    statusChoices: { gap: spacing[1] },
    statusChoice: { minHeight: 44, paddingHorizontal: spacing[3], borderRadius: 12, borderWidth: 1, borderColor: premium.stroke, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    statusChoiceActive: { borderColor: premium.coral, backgroundColor: premium.soft },
    statusChoiceLabel: { ...typography.bodySm, color: premium.text },
    statusChoiceLabelActive: { fontWeight: "700", color: premium.orange },
    statusRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: premium.muted, alignItems: "center", justifyContent: "center" },
    statusRadioActive: { borderColor: premium.orange },
    statusRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: premium.orange },
    fulfillmentChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    resetButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
    resetLabel: { ...typography.bodySm, color: premium.orange },
    error: { ...typography.bodySm, color: theme.danger },
    emptyState: { alignItems: "center", padding: spacing[5], gap: spacing[3], borderRadius: radius.xl, backgroundColor: premium.surface },
    cardTitle: { ...typography.titleSm, color: premium.text, textAlign: "center" },
    list: { gap: spacing[3] },
    order: { backgroundColor: premium.surface, borderColor: premium.stroke, borderWidth: 1, borderRadius: radius.xl, gap: spacing[3], padding: spacing[3], ...elevation.raised },
    statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing[2] },
    statusHeadline: { color: premium.orange, fontWeight: "700", fontSize: 16, textAlign: "right", flex: 1 },
    statusDanger: { color: theme.danger },
    modeText: { color: premium.muted, fontSize: 11 },
    orderBottom: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: premium.stroke },
    orderData: { flex: 1, gap: 3, alignItems: "flex-end" },
    orderId: { color: premium.muted, fontSize: 10 },
    orderTotal: { color: premium.text, fontSize: 15, fontWeight: "700", textAlign: "right" },
    trackButton: { flex: 1.5 },
  });
}

function sameIDs(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}
