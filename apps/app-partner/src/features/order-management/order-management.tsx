import { borders, radius, sizing, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniConfirmDialog, BthwaniIcon, BthwaniOrderChatSheet, useOrderChatUnreadCounts, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAssignment, type CaptainOffer, captainHandoffStateLabel, createDshMobileClient, formatMoney, formatOrderDate, formatQuantity, type Order, type OrderAdjustmentProposalRequest, type OrderTransitionRequest, orderStateLabel, paymentMethodLabel, paymentStateLabel, type StoreCaptainMembership } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { OrderConversation } from "./order-conversation";
import { mergeOrderPageRecords } from "./order-page-records";

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

function nextState(order: Order): OrderTransitionRequest["state"] | null {
  if (order.state === "CREATED") return "PARTNER_ACCEPTED";
  if (order.state === "PARTNER_ACCEPTED") return "PREPARING";
  if (order.state === "PREPARING") return order.fulfillmentMode === "CUSTOMER_PICKUP" ? "READY_FOR_PICKUP" : "READY_FOR_DISPATCH";
  return null;
}

const queueFilters = [
  { key: "ACTIVE", label: "النشطة", states: ["CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "READY_FOR_PICKUP", "CAPTAIN_ASSIGNED", "IN_CUSTODY"] },
  { key: "NEEDS_ACTION", label: "جديدة", states: ["CREATED"] },
  { key: "PREPARING", label: "التجهيز", states: ["PARTNER_ACCEPTED", "PREPARING"] },
  { key: "HANDOFF", label: "التسليم", states: ["READY_FOR_DISPATCH", "READY_FOR_PICKUP", "CAPTAIN_ASSIGNED", "IN_CUSTODY"] },
  { key: "CLOSED", label: "المنتهية", states: ["DELIVERED", "REJECTED", "CANCELLED", "PICKED_UP", "DELIVERY_FAILED"] },
] as const;

type QueueFilter = (typeof queueFilters)[number]["key"];
type StoreCaptainChoice = Readonly<{ actorId: string; label: string }>;
type OrderConfirmation =
  | Readonly<{ kind: "remove_line"; order: Order; lineID: string }>
  | Readonly<{ kind: "pickup_no_show"; order: Order }>
  | Readonly<{ kind: "reject"; order: Order }>
  | null;

function storeCaptainChoiceLabel(membership: StoreCaptainMembership): string {
  const parts = [membership.captainNameAr?.trim(), membership.captainPhoneMasked?.trim()].filter((value): value is string => Boolean(value));
  return parts.join(" · ") || "كابتن المتجر";
}

export function OrderManagement({ storeId }: { storeId?: string | undefined }) {
  const theme = useAppearanceTheme();
  const insets=useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isFocused = useIsFocused();
  const { q: rawQuery, orderId: rawTargetOrder } = useLocalSearchParams<{q?: string | string[]; orderId?: string | string[]}>();
  const targetOrderId = (Array.isArray(rawTargetOrder) ? rawTargetOrder[0] : rawTargetOrder)?.trim() ?? "";
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const { stores: scopedStores } = usePartnerStoreScope();
  const fulfillableStoreIDs = useMemo(() => new Set(scopedStores.filter((store) => store.owned || store.permissions.includes("fulfillment")).map((store) => store.id)), [scopedStores]);
  const canFulfillOrder = useCallback((orderStoreID: string) => fulfillableStoreIDs.has(orderStoreID), [fulfillableStoreIDs]);
  const loadGeneration = useRef(0);
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([]);
  const [assignments, setAssignments] = useState<Readonly<Record<string, CaptainAssignment>>>({});
  const [storeCaptainsByStore, setStoreCaptainsByStore] = useState<Readonly<Record<string, ReadonlyArray<StoreCaptainChoice>>>>({});
  const [dispatchOffers, setDispatchOffers] = useState<Readonly<Record<string, CaptainOffer>>>({});
  const [attention, setAttention] = useState<{ newOrders: number; awaitingDispatch: number; deliveryRecovery: number } | null>(null);
  const [cursor, setCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sidecarError, setSidecarError] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("ACTIVE");
  const [expandedOrderIds, setExpandedOrderIds] = useState<ReadonlySet<string>>(() => new Set());
  const [chatOrderId, setChatOrderId] = useState("");
  const openedTargetRef=useRef("");
  const closeDetails=(id:string)=>setExpandedOrderIds(current=>{const next=new Set(current);next.delete(id);return next;});
  const [pickupCodes, setPickupCodes] = useState<Readonly<Record<string, string>>>({});
  const [adjustmentQuantities, setAdjustmentQuantities] = useState<Readonly<Record<string, string>>>({});
  const [confirmation, setConfirmation] = useState<OrderConfirmation>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(searchQuery), 350); return () => clearTimeout(timer); }, [searchQuery]);
  const normalizedSearch = targetOrderId || debouncedSearch.trim();
  const getChatUnread = useCallback(async (orderId: string) => {
    const token = await getUsableIdentityAccessToken();
    return (await client().readOrderConversation(token, orderId, 1)).unreadCount;
  }, []);
  const currentSession = currentIdentityState();
  const unreadScope = currentSession.kind === "authenticated" ? currentSession.identity.subject.trim() : "";
  const unreadChatCounts = useOrderChatUnreadCounts(orders.map(order => order.id), unreadScope, isFocused, getChatUnread, chatOrderId);

  const load = useCallback(async (options: { append?: boolean; cursor?: string; quiet?: boolean } = {}) => {
    const generation = options.append ? loadGeneration.current : ++loadGeneration.current;
    if (options.append) setLoadingMore(true);
    else if (!options.quiet) {
      setLoading(true);
      setLoadingMore(false);
      setCursor("");
      setHasMore(false);
    }
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const queueStates = targetOrderId ? undefined : queueFilters.find(({ key }) => key === filter)?.states;
      const response = await client().listPartnerOrders(token, {
        ...(storeId ? { storeIds: [storeId] } : {}),
        ...(queueStates ? { state: queueStates.join(",") } : {}),
        ...(normalizedSearch ? { q: normalizedSearch } : {}),
        ...(options.append && options.cursor ? { cursor: options.cursor } : {}),
        limit: 50,
      });
      if (generation !== loadGeneration.current) return;
      setOrders((current) => options.append ? [...current, ...response.orders.filter((order) => !current.some((existing) => existing.id === order.id))] : response.orders);
      setAttention(response.attention);
      setCursor(response.nextCursor ?? "");
      setHasMore(Boolean(response.nextCursor));
      setSidecarError("");
      const nextOrders = response.orders;
      const assignmentOrders = nextOrders.filter((order) => canFulfillOrder(order.storeId) && (order.state === "CAPTAIN_ASSIGNED" || order.state === "IN_CUSTODY"));
      const offerOrders = nextOrders.filter((order) => canFulfillOrder(order.storeId) && order.fulfillmentMode === "PARTNER_CAPTAIN" && order.state === "READY_FOR_DISPATCH");
      if (assignmentOrders.length === 0 && offerOrders.length === 0) return;
      const offerStoreIDs = [...new Set(offerOrders.map((order) => order.storeId))];
      const [membershipResults, assignmentResults, offerResults] = await Promise.all([
        Promise.allSettled(offerStoreIDs.map(async (offerStoreID) => [offerStoreID, (await client().listPartnerStoreCaptainMemberships(token, offerStoreID)).memberships] as const)),
        Promise.allSettled(assignmentOrders.map(async (order) => {
        try { return [order.id, (await client().readStoreCaptainAssignment(token, order.storeId, order.id)).assignment] as const; }
        catch (cause) {
          if (cause && typeof cause === "object" && (cause as { kind?: unknown }).kind === "http" && (cause as { status?: unknown }).status === 404) return null;
          throw cause;
        }
        })),
        Promise.allSettled(offerOrders.map(async (order) => {
        try { return [order.id, (await client().readPartnerStoreCaptainDispatchOffer(token, order.storeId, order.id)).offer] as const; }
        catch (cause) {
          if (cause && typeof cause === "object" && (cause as { kind?: unknown }).kind === "http" && (cause as { status?: unknown }).status === 404) return null;
          throw cause;
        }
        })),
      ]);
      if (generation !== loadGeneration.current) return;
      const captainEntries = membershipResults.flatMap((entry): ReadonlyArray<readonly [string, ReadonlyArray<StoreCaptainChoice>]> => entry.status === "fulfilled"
        ? [[entry.value[0], entry.value[1].flatMap((membership: StoreCaptainMembership) => membership.state === "active" && membership.captainActorId ? [{ actorId: membership.captainActorId, label: storeCaptainChoiceLabel(membership) }] : [])]]
        : []);
      setStoreCaptainsByStore((current) => mergeOrderPageRecords(current, Object.fromEntries(captainEntries), Boolean(options.append)));
      setAssignments((current) => mergeOrderPageRecords(current, Object.fromEntries(assignmentResults.flatMap((entry) => entry.status === "fulfilled" && entry.value ? [entry.value] : [])), Boolean(options.append)));
      setDispatchOffers((current) => mergeOrderPageRecords(current, Object.fromEntries(offerResults.flatMap((entry) => entry.status === "fulfilled" && entry.value ? [entry.value] : [])), Boolean(options.append)));
      if (membershipResults.some((entry) => entry.status === "rejected") || assignmentResults.some((entry) => entry.status === "rejected") || offerResults.some((entry) => entry.status === "rejected")) {
        setSidecarError("تعذر قراءة بعض تفاصيل الكباتن، وستُحدّث تلقائيًا.");
      }
    } catch (cause) {
      console.error("DSH order list failed", cause);
      if (generation === loadGeneration.current) setError("تعذر قراءة الطلبات. ستُعاد المحاولة تلقائيًا.");
    } finally {
      if (generation === loadGeneration.current) { if (!options.quiet) setLoading(false); setLoadingMore(false); }
    }
  }, [canFulfillOrder, filter, normalizedSearch, storeId, targetOrderId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!targetOrderId || loading) return;
    const target = orders.find(order => order.id === targetOrderId);
    if (target && openedTargetRef.current!==targetOrderId) {openedTargetRef.current=targetOrderId;setExpandedOrderIds(()=>new Set([target.id]));}
  }, [targetOrderId, loading, orders]);
  useEffect(() => {
    if (!isFocused || loading || busy) return;
    const update = () => { if (AppState.currentState === "active") void load({ quiet: true }); };
    const timer = setInterval(update, 20_000);
    const resume = AppState.addEventListener("change", (state) => { if (state === "active") update(); });
    return () => { clearInterval(timer); resume.remove(); };
  }, [isFocused, loading, busy, load]);

  async function transition(order: Order, requestedState = nextState(order)) {
    if (!requestedState || busy || loading) return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().transitionStoreOrder(token, order.storeId, order.id, { state: requestedState }, order.version); await load(); }
    catch (cause) { console.error("DSH order transition failed", cause); setError("تعذر تنفيذ الإجراء؛ انتظر ظهور الحالة المؤكدة قبل إعادة المحاولة."); }
    finally { setBusy(""); }
  }

  async function proposeAdjustment(order: Order, lineID: string, kind: OrderAdjustmentProposalRequest["kind"], actualQuantityBaseUnits?: number) {
    if (busy || loading || !["PARTNER_ACCEPTED", "PREPARING"].includes(order.state)) return;
    setBusy(order.id); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const input: OrderAdjustmentProposalRequest = { orderLineId: lineID, kind, ...(actualQuantityBaseUnits === undefined ? {} : { actualQuantityBaseUnits }) };
      const result = await client().proposePartnerOrderAdjustment(token, order.storeId, order.id, input, order.version);
      setOrders((current) => current.map((item) => item.id === order.id ? result.order : item));
      setAdjustmentQuantities((current) => ({ ...current, [lineID]: "" }));
    } catch (cause) {
      console.error("DSH order adjustment proposal failed", cause);
      setError("تعذر إرسال التعديل؛ تحقق من حالة الطلب بعد المزامنة التلقائية قبل إعادة المحاولة.");
    } finally { setBusy(""); }
  }

  function confirmRemoveLine(order: Order, lineID: string) {
    setConfirmation({ kind: "remove_line", order, lineID });
  }

  async function confirmStorePickup(order: Order) {
    const code = toAsciiDigits(pickupCodes[order.id] ?? "").trim();
    if (!/^\d{6}$/.test(code) || busy || loading || order.state !== "READY_FOR_PICKUP") return;
    setBusy(order.id); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().transitionStoreOrder(token, order.storeId, order.id, { state: "PICKED_UP", code }, order.version);
      setPickupCodes((current) => ({ ...current, [order.id]: "" }));
      await load();
    } catch (cause) { console.error("DSH store pickup confirmation failed", cause); setError("تعذر تأكيد الاستلام؛ تحقق من الرمز والحالة الظاهرة قبل المحاولة مجددًا."); }
    finally { setBusy(""); }
  }

  async function confirmStoreCaptainCashHandoff(order: Order) {
    if (!canFulfillOrder(order.storeId) || busy || loading || order.fulfillmentMode !== "PARTNER_CAPTAIN" || order.state !== "DELIVERED" || order.storeCashHandoffState !== "AWAITING_STORE_HANDOFF") return;
    setBusy(order.id); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().confirmPartnerCaptainCashHandoff(token, order.storeId, order.id, order.version);
      await load();
    } catch (cause) { console.error("DSH Store Captain cash handoff confirmation failed", cause); setError("تعذر تأكيد استلام النقد؛ تحقق من الاستلام الفعلي وانتظر الحالة المؤكدة قبل المحاولة مجددًا."); }
    finally { setBusy(""); }
  }

  function markPickupNoShow(order: Order) {
    if (busy || loading || order.state !== "READY_FOR_PICKUP" || order.fulfillmentMode !== "CUSTOMER_PICKUP" || order.paymentMethod !== "CASH_AT_STORE" || order.paymentState !== "REQUIRES_COLLECTION") return;
    setConfirmation({ kind: "pickup_no_show", order });
  }

  async function confirmHandoff(order: Order, assignment: CaptainAssignment) {
    if (!canFulfillOrder(order.storeId) || busy || loading || assignment.handoff.state !== "pending") return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().confirmCaptainStoreHandoff(token, order.storeId, order.id, assignment.id, assignment.handoff.version); await load(); }
    catch (cause) { console.error("DSH Captain handoff failed", cause); setError("تعذر تأكيد جاهزية التسليم. أعد القراءة ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  async function dispatchToStoreCaptain(order: Order, captainActorId: string) {
    if (!canFulfillOrder(order.storeId) || busy || loading || order.fulfillmentMode !== "PARTNER_CAPTAIN" || order.state !== "READY_FOR_DISPATCH" || dispatchOffers[order.id]?.state === "offered") return;
    setBusy(order.id); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().createPartnerStoreCaptainDispatchOffer(token, order.storeId, order.id, { captainActorId }, order.version);
      setDispatchOffers((current) => ({ ...current, [order.id]: result.offer }));
      await load();
    } catch (cause) { console.error("DSH Store Captain dispatch failed", cause); setError("تعذر إرسال الطلب إلى كابتن المتجر؛ تحقق من الحالة بعد المزامنة التلقائية قبل إعادة الإرسال."); }
    finally { setBusy(""); }
  }

  return (
    <View style={styles.container} accessibilityLabel="إدارة طلبات المتجر">
      {!loading && attention ? <View style={styles.summaryRow} accessibilityLabel="ملخص طابور الطلبات">
          <View style={styles.summaryCard}><BthwaniIcon name="orders" size={21} color={theme.brandAction} /><Text style={styles.summaryValue}>{attention.newOrders}</Text><Text style={styles.summaryLabel}>طلبات جديدة</Text></View>
          <View style={styles.summaryCard}><BthwaniIcon name="store" size={21} color={theme.info} /><Text style={styles.summaryValue}>{attention.awaitingDispatch}</Text><Text style={styles.summaryLabel}>بانتظار التسليم</Text></View>
          <View style={styles.summaryCard}><BthwaniIcon name="warning" size={21} color={theme.warning} /><Text style={styles.summaryValue}>{attention.deliveryRecovery}</Text><Text style={styles.summaryLabel}>تسليم متعثر</Text></View>
        </View> : null}

      <ScrollView horizontal accessibilityLabel="تصفية طلبات المتجر" contentContainerStyle={styles.filterRow} showsHorizontalScrollIndicator={false}>
        {queueFilters.map(({ key, label }) =>
          <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: filter === key, disabled: loading || Boolean(busy) }} key={key} disabled={loading || Boolean(busy)} onPress={() => setFilter(key)} style={[styles.filterChip, filter === key && styles.filterSelected]}><Text style={[styles.filterLabel, filter === key && styles.filterLabelSelected]}>{label}</Text>{key === "NEEDS_ACTION" && attention?.newOrders ? <Text style={styles.filterCount}>{attention.newOrders}</Text> : null}</Pressable>)}
      </ScrollView>

      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة طلبات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الطلبات…</Text></View> : null}
      {sidecarError ? <Text accessibilityRole="alert" style={styles.muted}>{sidecarError}</Text> : null}
      {!loading && !orders.length && !error ? <Text style={styles.muted}>{
        normalizedSearch ? "لا توجد طلبات تطابق البحث." :
        filter === "ACTIVE" ? "لا توجد طلبات نشطة الآن. ستظهر الطلبات الجديدة تلقائيًا." :
        filter === "NEEDS_ACTION" ? "لا توجد طلبات جديدة الآن." :
        filter === "PREPARING" ? "لا توجد طلبات قيد التجهيز." :
        filter === "HANDOFF" ? "لا توجد طلبات في مرحلة التسليم." :
        "لا توجد طلبات في السجل حاليًا."
      }</Text> : null}

      {orders.map((order) => {
        const next = nextState(order);
        const openAdjustments = order.adjustments.filter((adjustment) => adjustment.state === "PROPOSED" || adjustment.state === "FINANCIAL_RECONCILIATION_REQUIRED");
        const hasOpenAdjustments = openAdjustments.length > 0;
        const assignment = assignments[order.id];
        const dispatchOffer = dispatchOffers[order.id];
        const actionDisabled = loading || Boolean(busy);
        let badgeIcon: "warning" | "success" | "orders" = "orders";
        let badgeTone: "danger" | "success" | "info" = "info";
        if (order.state === "REJECTED") {
          badgeIcon = "warning";
          badgeTone = "danger";
        } else if (order.state === "READY_FOR_DISPATCH" || order.state === "READY_FOR_PICKUP" || order.state === "PICKED_UP") {
          badgeIcon = "success";
          badgeTone = "success";
        }

        let settlementContent = <Text style={styles.muted}>ينتظر النظام تسجيل اكتمال تسليم الكابتن.</Text>;
        if (order.cashAmountMinor === 0) {
          if (order.paymentState === "COLLECTED") {
            settlementContent = <Text style={styles.muted}>غطّى رصيد العميل كامل المبلغ؛ لا يوجد نقد لاستلامه من الكابتن، وتم تسجيل التسوية.</Text>;
          } else {
            settlementContent = <Text style={styles.muted}>غطّى رصيد العميل كامل المبلغ؛ يجري تسجيل التسوية من دون عهدة نقدية.</Text>;
          }
        } else if (order.storeCashHandoffState === "AWAITING_STORE_HANDOFF") {
          settlementContent = <>
            <Text style={styles.muted}>استلم من الكابتن النقد المتبقي فقط: {formatMoney(order.cashAmountMinor, order.currency)}. لن تُسجل العمولة حتى تؤكد الاستلام الفعلي.</Text>
            <BthwaniButton busy={busy === order.id} disabled={actionDisabled} label="أكد استلام النقد من الكابتن" onPress={() => void confirmStoreCaptainCashHandoff(order)} />
          </>;
        } else if (order.storeCashHandoffState === "STORE_CONFIRMED") {
          settlementContent = <Text style={styles.muted}>أكدت استلام النقد. جارٍ تسجيل التحصيل والعمولة.</Text>;
        } else if (order.storeCashHandoffState === "SETTLED") {
          settlementContent = <Text style={styles.muted}>تم تأكيد التحصيل من المتجر وتسوية عمولة المنصة.</Text>;
        }

        const captainChoices = storeCaptainsByStore[order.storeId] ?? [];
        let nextActionLabel = "تحديث الحالة";
        if (next === "PARTNER_ACCEPTED") nextActionLabel = "قبول الطلب";
        else if (next === "PREPARING") nextActionLabel = "بدء التجهيز";
        else if (next === "READY_FOR_PICKUP") nextActionLabel = "جاهز للاستلام";

        return (

          <View key={order.id} style={styles.order}>
            <View style={styles.compactHeader}>
              <View style={styles.compactHeaderText}>
                <Text style={styles.orderTitle}>{"#" + order.id.slice(-8)}</Text>
                <Text style={styles.compactDim}>{formatOrderDate(order.createdAt)}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={"محادثة الطلب "+order.id.slice(-8)} onPress={()=>setChatOrderId(order.id)}
                style={{padding:8,borderRadius:12,backgroundColor:theme.surfaceRaised}}>
                <Text style={{fontSize:19}}>💬</Text>
                {unreadChatCounts[order.id] ? <Text accessibilityLabel={unreadChatCounts[order.id]+" رسائل غير مقروءة"} style={{color:theme.brandAction,fontSize:10,fontWeight:"800"}}>{(unreadChatCounts[order.id] ?? 0)>99?"99+":unreadChatCounts[order.id]}</Text> : null}
              </Pressable>
              <BthwaniStatusBadge icon={badgeIcon} label={orderStateLabel(order.state)} tone={badgeTone} />
            </View>
            <View style={styles.compactMetaRow}>
              <Text numberOfLines={1} style={styles.compactDim}>{order.fulfillmentMode === "CUSTOMER_PICKUP" ? "استلام من المتجر" : order.fulfillmentMode === "PARTNER_CAPTAIN" ? "توصيل المتجر" : "توصيل بثواني"} · {order.lines.length} {order.lines.length === 1 ? "صنف" : "أصناف"}</Text>
              {!storeId ? <Text numberOfLines={1} style={styles.compactDim}>{order.storeName}</Text> : null}
            </View>
            <View style={styles.compactMetaRow}>
              <Text numberOfLines={1} style={styles.compactPayment}>{paymentMethodLabel(order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)}</Text>
              <Text numberOfLines={1} style={styles.orderMoney}>{formatMoney(order.totalAmountMinor, order.currency)}</Text>
            </View>
            {hasOpenAdjustments && (next === "READY_FOR_DISPATCH" || next === "READY_FOR_PICKUP") ? <Text style={styles.error}>توجد تعديلات معلقة يجب إنهاؤها قبل التسليم.</Text> : null}
            <View style={styles.compactButtons}>
              {next === "PARTNER_ACCEPTED" ? <Pressable accessibilityRole="button" disabled={actionDisabled} onPress={() => setConfirmation({kind:"reject",order})} style={styles.compactReject}><Text style={styles.rejectLabel}>رفض</Text></Pressable> : null}
              {next ? <Pressable accessibilityRole="button" accessibilityLabel={nextActionLabel}
                accessibilityState={{disabled:actionDisabled || (hasOpenAdjustments && (next === "READY_FOR_DISPATCH" || next === "READY_FOR_PICKUP"))}}
                disabled={actionDisabled || (hasOpenAdjustments && (next === "READY_FOR_DISPATCH" || next === "READY_FOR_PICKUP"))}
                onPress={() => void transition(order)} style={[styles.compactPrimary,actionDisabled&&{opacity:0.5}]}>
                {busy === order.id ? <ActivityIndicator color={theme.onAction}/> : <BthwaniIcon name="success" size={16} color={theme.onAction}/>}
                <Text numberOfLines={1} style={styles.compactPrimaryLabel}>{nextActionLabel}</Text>
              </Pressable> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={"عرض تفاصيل الطلب " + order.id.slice(-8)}
                onPress={() => setExpandedOrderIds(() => new Set([order.id]))} style={styles.compactDetails}>
                <Text style={styles.compactDetailsLabel}>التفاصيل</Text>
              </Pressable>
            </View>
            <Modal transparent statusBarTranslucent animationType="slide" visible={expandedOrderIds.has(order.id)} onRequestClose={()=>closeDetails(order.id)}>
              <View style={styles.sheetOverlay}>
                <Pressable accessibilityRole="button" accessibilityLabel="إغلاق التفاصيل" style={styles.sheetScrim} onPress={()=>closeDetails(order.id)}/>
                <View style={[styles.sheet,{paddingBottom:Math.max(insets.bottom,12)}]}>
                  <View style={styles.sheetGrabber}/>
                  <View style={styles.sheetTop}>
                    <View style={styles.sheetTitleArea}><Text style={styles.sheetTitle}>تفاصيل الطلب #{order.id.slice(-8)}</Text><Text style={styles.compactDim}>{formatOrderDate(order.createdAt)}</Text></View>
                    <Pressable accessibilityRole="button" accessibilityLabel="إغلاق تفاصيل الطلب" onPress={()=>closeDetails(order.id)} style={styles.sheetClose}><Text style={styles.sheetCloseLabel}>إغلاق</Text></Pressable>
                  </View>
                  <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
                    <View style={styles.sheetSummary}>
                      <BthwaniStatusBadge icon={badgeIcon} label={orderStateLabel(order.state)} tone={badgeTone}/>
                      <Text style={styles.sheetHeading}>ملخص الطلب</Text>
                      <View style={styles.sheetFact}><Text style={styles.compactDim}>الإجمالي</Text><Text style={styles.orderMoney}>{formatMoney(order.totalAmountMinor,order.currency)}</Text></View>
                      <View style={styles.sheetFact}><Text style={styles.compactDim}>الدفع</Text><Text style={styles.sheetFactValue}>{paymentMethodLabel(order.paymentMethod,order.fulfillmentMode,order.cashAmountMinor)}</Text></View>
                    </View>
            {expandedOrderIds.has(order.id) ? <>
            <Text style={styles.sheetHeading}>العنوان والملاحظات</Text>
            <Text style={styles.muted}>{order.fulfillmentMode === "CUSTOMER_PICKUP" ? "طريقة الاستلام: الاستلام من المتجر" : order.fulfillmentMode === "BTHWANI_CAPTAIN" ? "التوصيل بواسطة كابتن بثواني" : `العنوان: ${order.addressText}`}</Text>
            {order.customerNote ? <View style={styles.handoff}><Text style={styles.lineTitle}>ملاحظات العميل للمتجر</Text><Text selectable style={styles.muted}>{order.customerNote}</Text></View> : null}
            {order.fulfillmentMode === "PARTNER_CAPTAIN" ? <View style={styles.handoff}>
              <Text style={styles.lineTitle}>{order.recipient.mode === "OTHER" ? "مستلم الطلب" : "المستلم: صاحب الطلب"}</Text>
              {order.recipient.mode === "OTHER" ? <>
                <Text selectable style={styles.muted}>{order.recipient.name}</Text>
                <Text selectable style={styles.muted}>{order.recipient.phoneE164}</Text>
                {order.recipient.instructions ? <Text style={styles.muted}>تعليمات التوصيل: {order.recipient.instructions}</Text> : null}
              </> : null}
            </View> : null}
            <Text style={styles.sheetHeading}>الأصناف والتجهيز</Text>
            <View style={styles.lines}>
              {order.lines.map((line) => <View key={line.id} style={styles.line}><Text style={styles.lineTitle}>{line.productName} · {line.variantTitle}</Text><Text style={styles.muted}>المطلوب: {formatQuantity(line.baseUnit, line.requestedQuantityBaseUnits)} · النهائي: {formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)}</Text><Text style={styles.muted}>{pricingBasisLabel(line.pricingBasis)} · {formatMoney(line.lineAmountMinor, line.currency)}{line.modifierAmountMinor > 0 ? ` · الإضافات: ${formatMoney(line.modifierAmountMinor, line.currency)}` : ""}</Text>{line.modifierSnapshots.length ? <Text style={styles.muted}>الإضافات المحددة: {line.modifierSnapshots.map((modifier) => modifier.optionNameAr).join("، ")}</Text> : null}{line.attributeSnapshots.length ? <Text style={styles.muted}>تفاصيل المنتج: {line.attributeSnapshots.map((attribute) => `${attribute.code}: ${attributeSnapshotValue(attribute)}`).join("، ")}</Text> : null}</View>)}
            </View>
            {(order.state === "PARTNER_ACCEPTED" || order.state === "PREPARING") ? <View style={styles.adjustmentActions} accessibilityLabel="تعديلات أصناف الطلب">
              {order.lines.map((line) => {
                const openForLine = order.adjustments.some((adjustment) => adjustment.orderLineId === line.id && (adjustment.state === "PROPOSED" || adjustment.state === "FINANCIAL_RECONCILIATION_REQUIRED"));
                if (openForLine) return null;
                return <View key={line.id} style={styles.adjustmentLine}>
                  <Text style={styles.muted}>تعذّر توفير: {line.productName}</Text>
                  <BthwaniButton disabled={actionDisabled} label="إبلاغ العميل عن عدم التوفر" onPress={() => confirmRemoveLine(order, line.id)} variant="secondary" />
                  {line.measurementKind === "VARIABLE_MEASURE" ? <>
                    <Text style={styles.muted}>الكمية المقبولة من {formatQuantity(line.baseUnit, line.quantityMinBaseUnits)} إلى {formatQuantity(line.baseUnit, line.quantityMaxBaseUnits)}، بخطوة {formatQuantity(line.baseUnit, line.quantityStepBaseUnits)}.</Text>
                    <TextInput accessibilityLabel={`الكمية الفعلية للصنف ${line.productName} بوحدة ${line.baseUnit}`} editable={!actionDisabled} keyboardType="number-pad" onChangeText={(value) => setAdjustmentQuantities((current) => ({ ...current, [line.id]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} placeholder={line.baseUnit === "GRAM" ? "الكمية الفعلية بالغرام" : "الكمية الفعلية"} placeholderTextColor={theme.colorMuted} style={styles.adjustmentInput} value={adjustmentQuantities[line.id] ?? ""} />
                    <BthwaniButton disabled={actionDisabled || !isValidAdjustmentQuantity(line, adjustmentQuantities[line.id] ?? "")} label="إرسال الكمية الفعلية للعميل" onPress={() => void proposeAdjustment(order, line.id, "SET_ACTUAL_QUANTITY", Number(adjustmentQuantities[line.id]))} variant="secondary" />
                  </> : null}
                </View>;
              })}
            </View> : null}
            {order.adjustments.map((adjustment) => {
              const line = order.lines.find((candidate) => candidate.id === adjustment.orderLineId);
              const status = adjustment.state === "PROPOSED" ? "بانتظار قرار العميل" : adjustment.state === "REJECTED" ? "رفض العميل التعديل" : "وافق العميل؛ الطلب متوقف حتى حسم التسوية المالية";
              return <View key={adjustment.id} style={styles.adjustmentNotice}><Text style={styles.lineTitle}>{adjustment.kind === "REMOVE_ITEM" ? "إزالة صنف" : "تعديل كمية"}{line ? ` · ${line.productName}` : ""}</Text><Text style={styles.muted}>{status}. المبلغ الأصلي محفوظ ولا يوجد استرداد أو تحصيل إضافي تلقائي.</Text></View>;
            })}
            <Text style={styles.sheetHeading}>التسليم والتسوية</Text>
            {canFulfillOrder(order.storeId) && assignment ? <View style={styles.handoff}><BthwaniStatusBadge icon={assignment.handoff.state === "completed" ? "success" : "deliveries"} label={`تسليم المتجر: ${captainHandoffStateLabel(assignment.handoff.state)}`} tone={assignment.handoff.state === "completed" ? "success" : "warning"} />{assignment.handoff.state === "pending" ? <BthwaniButton busy={busy === order.id} disabled={actionDisabled} label="تأكيد جاهزية التسليم" onPress={() => void confirmHandoff(order, assignment)} /> : null}</View> : null}
            {canFulfillOrder(order.storeId) && order.fulfillmentMode === "PARTNER_CAPTAIN" && order.state === "READY_FOR_DISPATCH" ? <View style={styles.handoff} accessibilityLabel="إسناد طلب التوصيل إلى كابتن المتجر"><Text style={styles.lineTitle}>إسناد الطلب إلى كابتن المتجر</Text>{dispatchOffer?.state === "offered" ? <Text style={styles.muted}>أُرسل الطلب إلى {captainChoices.find((captain) => captain.actorId === dispatchOffer.captainActorId)?.label ?? "كابتن المتجر"} وبانتظار قبوله.</Text> : <>{dispatchOffer ? <Text style={styles.muted}>{dispatchOffer.state === "rejected" ? "رفض الكابتن العرض. يمكنك إرساله إلى كابتن آخر." : "انتهت مهلة العرض. يمكنك إرساله إلى كابتن آخر."}</Text> : null}{captainChoices.length ? captainChoices.map((captain) => <BthwaniButton key={captain.actorId} busy={busy === order.id} disabled={actionDisabled} label={`إرسال الطلب إلى ${captain.label}`} onPress={() => void dispatchToStoreCaptain(order, captain.actorId)} variant="secondary" />) : <Text style={styles.muted}>لا يوجد كابتن نشط مرتبط بهذا المتجر. أرسل دعوة للكابتن واطلب منه قبولها في تطبيق الكابتن.</Text>}</>}</View> : null}
            {order.state === "READY_FOR_PICKUP" ? <View style={styles.pickupConfirmation}><TextInput accessibilityLabel="رمز الاستلام الذي قدمه العميل" editable={!actionDisabled} keyboardType="number-pad" maxLength={6} onChangeText={(value) => setPickupCodes((current) => ({ ...current, [order.id]: toAsciiDigits(value).replace(/[^0-9]/g, "").slice(0, 6) }))} placeholder="رمز الاستلام من العميل" placeholderTextColor={theme.colorMuted} style={styles.pickupCodeInput} textAlign="center" value={pickupCodes[order.id] ?? ""} /><BthwaniButton busy={busy === order.id} disabled={actionDisabled || toAsciiDigits(pickupCodes[order.id] ?? "").length !== 6} label="تأكيد استلام العميل" onPress={() => void confirmStorePickup(order)} />{order.fulfillmentMode === "CUSTOMER_PICKUP" && order.paymentMethod === "CASH_AT_STORE" && order.paymentState === "REQUIRES_COLLECTION" ? <BthwaniButton disabled={actionDisabled} label="العميل لم يحضر" onPress={() => markPickupNoShow(order)} variant="danger" /> : null}</View> : null}
            {canFulfillOrder(order.storeId) && order.fulfillmentMode === "PARTNER_CAPTAIN" && order.state === "DELIVERED" ? <View style={styles.pickupConfirmation}><Text style={styles.lineTitle}>تسوية طلب توصيل المتجر</Text>{settlementContent}</View> : null}
            </> : null}
            {expandedOrderIds.has(order.id) ? <Pressable accessibilityRole="button" accessibilityLabel="فتح محادثة الطلب" onPress={()=>{closeDetails(order.id);setChatOrderId(order.id);}} style={{padding:12}}>
              <Text style={{color:theme.brandAction,fontWeight:"800"}}>💬 فتح محادثة الطلب</Text>
            </Pressable> : null}
                  </ScrollView>
                  {next ? <View style={styles.sheetFooter}>
                    {next === "PARTNER_ACCEPTED" ? <Pressable accessibilityRole="button" disabled={actionDisabled} onPress={() => setConfirmation({kind:"reject",order})} style={styles.compactReject}><Text style={styles.rejectLabel}>رفض الطلب</Text></Pressable> : null}
                    <Pressable accessibilityRole="button" accessibilityLabel={nextActionLabel}
                      disabled={actionDisabled || (hasOpenAdjustments && (next === "READY_FOR_DISPATCH" || next === "READY_FOR_PICKUP"))}
                      accessibilityState={{disabled:actionDisabled || (hasOpenAdjustments && (next === "READY_FOR_DISPATCH" || next === "READY_FOR_PICKUP"))}}
                      onPress={()=>void transition(order)} style={styles.compactPrimary}>
                      {busy===order.id ? <ActivityIndicator color={theme.onAction}/> : <BthwaniIcon name="success" color={theme.onAction} size={17}/>}
                      <Text numberOfLines={1} style={styles.compactPrimaryLabel}>{nextActionLabel}</Text>
                    </Pressable>
                  </View> : null}
                </View>
              </View>
            </Modal>
            <BthwaniOrderChatSheet visible={chatOrderId===order.id} bottomInset={insets.bottom} onClose={()=>setChatOrderId("")}
              orderReference={order.id.slice(-8)} status={orderStateLabel(order.state)}
              summary={order.storeName+" · "+order.lines.length+" أصناف · "+(order.fulfillmentMode==="CUSTOMER_PICKUP"?"استلام من المتجر":order.fulfillmentMode==="PARTNER_CAPTAIN"?"توصيل المتجر":"توصيل بثواني")}
              total={formatMoney(order.totalAmountMinor,order.currency)}
              onDetails={()=>{setChatOrderId("");setExpandedOrderIds(()=>new Set([order.id]));}}>
              {chatOrderId===order.id?<OrderConversation orderId={order.id}/>:null}
            </BthwaniOrderChatSheet>
          </View>
        );
      })}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {hasMore ? <BthwaniButton busy={loadingMore} disabled={loading || loadingMore || Boolean(busy)} label="تحميل طلبات أكثر" onPress={() => void load({ append: true, cursor })} variant="secondary" /> : null}

      <BthwaniConfirmDialog
        busy={Boolean(confirmation && busy === confirmation.order.id)}
        confirmLabel={confirmation?.kind === "pickup_no_show" ? "تأكيد عدم الحضور" : confirmation?.kind === "reject" ? "تأكيد الرفض" : "إرسال للعميل"}
        description={confirmation?.kind === "pickup_no_show"
          ? "سيُلغى الطلب غير المستلم، ويُحرر المخزون المحجوز، ويُلغى التحصيل غير المدفوع. لا تسجل ذلك إذا كان العميل قد استلم الطلب."
          : confirmation?.kind === "reject" ? "سيُرفض الطلب ويُبلّغ العميل. تأكد من تعذر تجهيزه قبل المتابعة."
          : confirmation?.kind === "remove_line"
            ? "سيُرسل طلب إزالة الصنف إلى العميل للموافقة. لا يتغير إجمالي الطلب ولا يُنفذ استرداد تلقائي؛ سيبقى الطلب متوقفًا حتى اكتمال التسوية المالية المعتمدة."
            : ""}
        intent={confirmation?.kind === "pickup_no_show" || confirmation?.kind === "reject" ? "danger" : "primary"}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const pending = confirmation;
          setConfirmation(null);
          if (pending?.kind === "pickup_no_show") void transition(pending.order, "CANCELLED");
          else if (pending?.kind === "reject") void transition(pending.order, "REJECTED");
          else if (pending?.kind === "remove_line") void proposeAdjustment(pending.order, pending.lineID, "REMOVE_ITEM");
        }}
        title={confirmation?.kind === "pickup_no_show" ? "تسجيل عدم حضور العميل" : confirmation?.kind === "reject" ? "رفض الطلب" : "إبلاغ العميل عن صنف غير متوفر"}
        visible={Boolean(confirmation)}
      />
    </View>
  );
}

function isValidAdjustmentQuantity(line: Order["lines"][number], value: string): boolean {
  const actual = Number(value);
  const step = line.quantityStepBaseUnits;
  return Number.isSafeInteger(actual)
    && step > 0
    && actual < line.requestedQuantityBaseUnits
    && actual >= line.quantityMinBaseUnits
    && actual <= line.quantityMaxBaseUnits
    && (actual - line.quantityMinBaseUnits) % step === 0;
}

function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
}

function pricingBasisLabel(basis: Order["lines"][number]["pricingBasis"]): string { return basis === "PER_UNIT" ? "لكل قطعة" : "لكل وحدة قياس"; }

function attributeSnapshotValue(attribute: Order["lines"][number]["attributeSnapshots"][number]): string {
  if (attribute.textValue) return attribute.textValue;
  if (attribute.integerValue !== undefined && attribute.integerValue !== null) return String(attribute.integerValue);
  if (attribute.decimalValue) return attribute.decimalValue;
  if (attribute.booleanValue !== undefined && attribute.booleanValue !== null) return attribute.booleanValue ? "نعم" : "لا";
  if (attribute.enumValue) return attribute.enumValue;
  if (attribute.dateValue) return attribute.dateValue;
  return "—";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { gap: 9, paddingTop: 10, width: "100%" },
    toolbar: { alignItems: "center", flexDirection: "row", justifyContent: "flex-end", minHeight: 30 },
    archiveButton: { minHeight: 30, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[2] },
    archiveText: { ...typography.label, color: theme.brandAction },
    expandButton: { alignSelf: "flex-start", minHeight: 40, justifyContent: "center", paddingHorizontal: spacing[2] },
    expandText: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleLg, fontSize: 28, fontWeight: "800", color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    summaryRow: { flexDirection: "row", gap: spacing[2] },
    summaryCard: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, flex: 1, gap: 3, paddingVertical: 7, paddingHorizontal: 4 },
    summaryValue: { ...typography.titleSm, color: theme.color, fontWeight: "800" },
    summaryLabel: { ...typography.caption, color: theme.colorMuted, textAlign: "center" },
    filterRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingBottom: spacing[1] },
    order: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 13, borderWidth: 1, gap: 6, padding: 10 },

    compactHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},
    compactHeaderText:{flex:1,minWidth:0,gap:2},
    compactDim:{...typography.caption,color:theme.colorMuted,fontSize:11,flexShrink:1},
    compactPayment:{...typography.caption,color:theme.interactiveText,flexShrink:1,fontSize:12},
    compactMetaRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:7},
    compactButtons:{flexDirection:"row",alignItems:"center",gap:7},
    compactPrimary:{flex:1.35,backgroundColor:theme.brandAction,borderRadius:9,minHeight:39,paddingHorizontal:6,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:5},
    compactPrimaryLabel:{...typography.label,fontSize:12,color:theme.onAction,fontWeight:"800"},
    compactReject:{flex:0.7,minHeight:39,borderRadius:9,borderWidth:1,borderColor:theme.borderColor,alignItems:"center",justifyContent:"center"},
    compactDetails:{flex:0.75,minHeight:39,borderRadius:9,borderWidth:1,borderColor:theme.borderColor,backgroundColor:theme.surfaceRaised,alignItems:"center",justifyContent:"center"},
    compactDetailsLabel:{...typography.label,fontSize:12,color:theme.interactiveText},
    sheetOverlay:{flex:1,justifyContent:"flex-end",backgroundColor:"#00000088"},
    sheetScrim:{...StyleSheet.absoluteFill},
    sheet:{backgroundColor:theme.background,maxHeight:"91%",minHeight:"42%",borderTopLeftRadius:22,borderTopRightRadius:22,paddingTop:8,overflow:"hidden"},
    sheetGrabber:{alignSelf:"center",width:44,height:4,borderRadius:4,backgroundColor:theme.borderColor,marginBottom:9},
    sheetTop:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:15,paddingBottom:11,borderBottomWidth:1,borderColor:theme.borderColor,gap:10},
    sheetTitleArea:{flex:1,gap:3},
    sheetTitle:{...typography.titleSm,color:theme.color,fontWeight:"800"},
    sheetClose:{backgroundColor:theme.surfaceRaised,minHeight:38,paddingHorizontal:12,borderRadius:9,alignItems:"center",justifyContent:"center"},
    sheetCloseLabel:{...typography.label,color:theme.color},
    sheetScroll:{minHeight:0},sheetContent:{padding:12,paddingBottom:64,gap:8},
    sheetSummary:{backgroundColor:theme.surface,borderWidth:1,borderColor:theme.borderColor,borderRadius:12,padding:12,gap:9},
    sheetHeading:{...typography.bodyStrong,color:theme.color,fontWeight:"800",fontSize:14},
    sheetFact:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:10},
    sheetFactValue:{...typography.bodySm,color:theme.color,flexShrink:1},
    sheetFooter:{borderTopWidth:1,borderColor:theme.borderColor,backgroundColor:theme.surface,flexDirection:"row",gap:9,padding:10},

    payment: { ...typography.bodySm, color: theme.interactiveText },
    lines: { gap: spacing[2], marginTop: spacing[1] },
    line: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[1], paddingTop: spacing[2] },
    adjustmentActions: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2] },
    adjustmentLine: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[2], paddingTop: spacing[2] },
    adjustmentInput: { ...typography.body, backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[3], textAlign: "right" },
    adjustmentNotice: { backgroundColor: theme.actionSoft, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    lineTitle: { ...typography.bodyStrong, color: theme.color },
    handoff: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], marginTop: spacing[1], padding: spacing[2] },
    pickupConfirmation: { backgroundColor: theme.actionSoft, borderRadius: radius.sm, gap: spacing[2], padding: spacing[2] },
    pickupCodeInput: { ...typography.titleSm, backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: 48, paddingHorizontal: spacing[3] },
    actionRow: { flexDirection: "row", gap: 9 },
    actionsContainer: { gap: 7 },
    primaryAction: { flex: 2, backgroundColor: theme.brandAction, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, minHeight: 47 },
    primaryActionLabel: { ...typography.bodyStrong, color: theme.onAction },
    rejectButton: { flex: 1, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 47 },
    rejectLabel: { ...typography.bodyStrong, color: theme.color },
    filterChip: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, minHeight: 36, borderRadius: 11, paddingHorizontal: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
    filterSelected: { backgroundColor: theme.actionSoft, borderColor: theme.brandAction },
    filterLabel: { ...typography.bodySm, color: theme.colorMuted },
    filterLabelSelected: { color: theme.brandAction, fontWeight: "700" },
    filterCount: { ...typography.caption, color: theme.brandAction, fontWeight: "800" },
    orderMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: theme.surfaceRaised, borderRadius: 9, padding: 6 },
    orderPriceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    orderMoney: { ...typography.titleSm, color: theme.color, fontWeight: "800" },
    orderTitle: { ...typography.titleSm, color: theme.color, fontWeight: "800" },
    orderHeaderCopy: { flex: 1, gap: spacing[1] },
    orderHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
    actionButton: { flex: 1 },
    error: { ...typography.label, color: theme.danger },
  });
}
