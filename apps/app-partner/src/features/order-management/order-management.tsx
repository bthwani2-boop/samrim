import { borders, radius, sizing, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAssignment, type CaptainOffer, captainHandoffStateLabel, createDshMobileClient, formatMoney, formatOrderDate, formatQuantity, type Order, type OrderAdjustmentProposalRequest, type OrderTransitionRequest, orderStateLabel, paymentMethodLabel, paymentStateLabel, type StoreCaptainMembership } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";

import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { OrderConversation } from "./order-conversation";

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
  { key: "ALL", label: "الكل", states: undefined },
  { key: "NEEDS_ACTION", label: "تحتاج إجراء", states: ["CREATED"] },
  { key: "PREPARING", label: "قيد التجهيز", states: ["PARTNER_ACCEPTED", "PREPARING"] },
  { key: "HANDOFF", label: "التسليم", states: ["READY_FOR_DISPATCH", "READY_FOR_PICKUP", "CAPTAIN_ASSIGNED", "IN_CUSTODY"] },
  { key: "CLOSED", label: "مغلقة", states: ["DELIVERED", "REJECTED", "CANCELLED", "PICKED_UP", "DELIVERY_FAILED"] },
] as const;

type QueueFilter = (typeof queueFilters)[number]["key"];

export function OrderManagement({ storeId }: { storeId?: string | undefined }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { q: rawQuery } = useLocalSearchParams<{ q?: string | string[] }>();
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const { stores: scopedStores } = usePartnerStoreScope();
  const fulfillableStoreIDs = useMemo(() => new Set(scopedStores.filter((store) => store.owned || store.permissions.includes("fulfillment")).map((store) => store.id)), [scopedStores]);
  const canFulfillOrder = useCallback((orderStoreID: string) => fulfillableStoreIDs.has(orderStoreID), [fulfillableStoreIDs]);
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([]);
  const [assignments, setAssignments] = useState<Readonly<Record<string, CaptainAssignment>>>({});
  const [storeCaptainActorIDsByStore, setStoreCaptainActorIDsByStore] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({});
  const [dispatchOffers, setDispatchOffers] = useState<Readonly<Record<string, CaptainOffer>>>({});
  const [attention, setAttention] = useState<{ newOrders: number; awaitingDispatch: number; deliveryRecovery: number } | null>(null);
  const [cursor, setCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sidecarError, setSidecarError] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("ALL");
  const [pickupCodes, setPickupCodes] = useState<Readonly<Record<string, string>>>({});
  const [adjustmentQuantities, setAdjustmentQuantities] = useState<Readonly<Record<string, string>>>({});
  const normalizedSearch = searchQuery.trim();

  const load = useCallback(async (options: { append?: boolean; cursor?: string } = {}) => {
    if (options.append) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const queueStates = queueFilters.find(({ key }) => key === filter)?.states;
      const response = await client().listPartnerOrders(token, {
        ...(storeId ? { storeIds: [storeId] } : {}),
        ...(queueStates ? { state: queueStates.join(",") } : {}),
        ...(normalizedSearch ? { q: normalizedSearch } : {}),
        ...(options.append && options.cursor ? { cursor: options.cursor } : {}),
        limit: 50,
      });
      setOrders((current) => options.append ? [...current, ...response.orders.filter((order) => !current.some((existing) => existing.id === order.id))] : response.orders);
      setAttention(response.attention);
      setCursor(response.nextCursor ?? "");
      setHasMore(Boolean(response.nextCursor));
      setSidecarError("");
      const nextOrders = response.orders;
      const assignmentOrders = nextOrders.filter((order) => canFulfillOrder(order.storeId) && (order.state === "CAPTAIN_ASSIGNED" || order.state === "IN_CUSTODY"));
      const offerOrders = nextOrders.filter((order) => canFulfillOrder(order.storeId) && order.fulfillmentMode === "PARTNER_CAPTAIN" && order.state === "READY_FOR_DISPATCH");
      if (assignmentOrders.length === 0 && offerOrders.length === 0) {
        setAssignments({});
        setStoreCaptainActorIDsByStore({});
        setDispatchOffers({});
        return;
      }
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
      const captainEntries = membershipResults.flatMap((entry): ReadonlyArray<readonly [string, ReadonlyArray<string>]> => entry.status === "fulfilled"
        ? [[entry.value[0], entry.value[1].flatMap((membership: StoreCaptainMembership) => membership.state === "active" && membership.captainActorId ? [membership.captainActorId] : [])]]
        : []);
      setStoreCaptainActorIDsByStore(Object.fromEntries(captainEntries));
      setAssignments(Object.fromEntries(assignmentResults.flatMap((entry) => entry.status === "fulfilled" && entry.value ? [entry.value] : [])));
      setDispatchOffers(Object.fromEntries(offerResults.flatMap((entry) => entry.status === "fulfilled" && entry.value ? [entry.value] : [])));
      if (membershipResults.some((entry) => entry.status === "rejected") || assignmentResults.some((entry) => entry.status === "rejected") || offerResults.some((entry) => entry.status === "rejected")) {
        setSidecarError("تم تحميل الطلبات، لكن تعذر قراءة بعض تفاصيل كباتن المتجر. يمكنك إعادة تحديث الطلبات.");
      }
    } catch (cause) { console.error("DSH order list failed", cause); setError("تعذر قراءة الطلبات. أعد المحاولة."); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [canFulfillOrder, filter, normalizedSearch, storeId]);

  useEffect(() => { void load(); }, [load]);

  async function transition(order: Order, requestedState = nextState(order)) {
    if (!requestedState || busy || loading) return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().transitionStoreOrder(token, order.storeId, order.id, { state: requestedState }, order.version); await load(); }
    catch (cause) { console.error("DSH order transition failed", cause); setError("تعذر تحديث حالة الطلب. أعد القراءة ثم حاول مرة أخرى."); }
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
      setError("تعذر إرسال التعديل. حدّث الطلب وتحقق من حالته قبل إعادة المحاولة.");
    } finally { setBusy(""); }
  }

  function confirmRemoveLine(order: Order, lineID: string) {
    Alert.alert("إبلاغ العميل عن صنف غير متوفر", "سيُرسل طلب إزالة الصنف إلى العميل للموافقة. لا يتغير إجمالي الطلب ولا يُنفذ استرداد تلقائي؛ سيبقى الطلب متوقفًا حتى اكتمال التسوية المالية المعتمدة.", [
      { text: "العودة", style: "cancel" },
      { text: "إرسال للعميل", onPress: () => void proposeAdjustment(order, lineID, "REMOVE_ITEM") },
    ]);
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
    } catch (cause) { console.error("DSH store pickup confirmation failed", cause); setError("تعذر تأكيد رمز الاستلام. تحقق من الرمز ثم حدّث الطلب قبل إعادة المحاولة."); }
    finally { setBusy(""); }
  }

  async function confirmStoreCaptainCashHandoff(order: Order) {
    if (!canFulfillOrder(order.storeId) || busy || loading || order.fulfillmentMode !== "PARTNER_CAPTAIN" || order.state !== "DELIVERED" || order.storeCashHandoffState !== "AWAITING_STORE_HANDOFF") return;
    setBusy(order.id); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().confirmPartnerCaptainCashHandoff(token, order.storeId, order.id, order.version);
      await load();
    } catch (cause) { console.error("DSH Store Captain cash handoff confirmation failed", cause); setError("تعذر تأكيد استلام النقد من الكابتن. تحقق من الاستلام الفعلي ثم أعد قراءة الطلب قبل المحاولة."); }
    finally { setBusy(""); }
  }

  function markPickupNoShow(order: Order) {
    if (busy || loading || order.state !== "READY_FOR_PICKUP" || order.fulfillmentMode !== "CUSTOMER_PICKUP" || order.paymentMethod !== "CASH_AT_STORE" || order.paymentState !== "REQUIRES_COLLECTION") return;
    Alert.alert("تسجيل عدم حضور العميل", "سيُلغى الطلب غير المستلم، ويُحرر المخزون المحجوز، ويُلغى التحصيل غير المدفوع. لا تسجل ذلك إذا كان العميل قد استلم الطلب.", [
      { text: "العودة", style: "cancel" },
      { text: "تأكيد عدم الحضور", style: "destructive", onPress: () => void transition(order, "CANCELLED") },
    ]);
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
    } catch (cause) { console.error("DSH Store Captain dispatch failed", cause); setError("تعذر إرسال الطلب إلى كابتن المتجر. أعد قراءة الطلبات والعضويات ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  return (
    <View style={styles.container} accessibilityLabel="إدارة طلبات المتجر">
      <Text style={styles.title}>طلبات المتجر</Text>
      <Text style={styles.muted}>تابع الطلبات حسب ما يحتاج إجراءً الآن، ثم افتح تفاصيل المنتجات عند الحاجة.</Text>

      {!loading && attention ? (
        <View style={styles.summaryRow} accessibilityLabel="ملخص طابور الطلبات">
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{attention.newOrders}</Text><Text style={styles.summaryLabel}>تحتاج إجراء</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{attention.awaitingDispatch}</Text><Text style={styles.summaryLabel}>بانتظار التسليم</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{attention.deliveryRecovery}</Text><Text style={styles.summaryLabel}>تسليم متعثر</Text></View>
        </View>
      ) : null}

      <View style={styles.filterRow} accessibilityLabel="تصفية طلبات المتجر">
        {queueFilters.map(({ key, label }) => <BthwaniChip key={key} disabled={loading || Boolean(busy)} label={label} onPress={() => setFilter(key)} selected={filter === key} />)}
      </View>

      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة طلبات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الطلبات…</Text></View> : null}
      {sidecarError ? <Text accessibilityRole="alert" style={styles.muted}>{sidecarError}</Text> : null}
      {!loading && !orders.length ? <Text style={styles.muted}>لا توجد طلبات مطابقة حاليًا.</Text> : null}

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

        let nextActionLabel = "جاهز للتسليم";
        if (next === "PARTNER_ACCEPTED") {
          nextActionLabel = "قبول الطلب";
        } else if (next === "PREPARING") {
          nextActionLabel = "بدء التجهيز";
        } else if (next === "READY_FOR_PICKUP") {
          nextActionLabel = "جاهز للاستلام";
        }

        return (
          <View key={order.id} style={styles.order}>
            <View style={styles.orderHeader}>
              <View style={styles.orderHeaderCopy}>
                <Text style={styles.orderTitle}>{storeId ? `طلب بتاريخ ${formatOrderDate(order.createdAt)}` : `${order.storeName} · طلب بتاريخ ${formatOrderDate(order.createdAt)}`}</Text>
                <Text style={styles.muted}>{order.lines.length} منتج · {formatMoney(order.totalAmountMinor, order.currency)}</Text><Text style={styles.payment}>{order.cashAmountMinor === 0 ? "لا يوجد نقد مطلوب؛ المبلغ مغطى من رصيد العميل" : `النقد المطلوب عند الاستلام: ${formatMoney(order.cashAmountMinor, order.currency)}`}</Text><Text style={styles.payment}>{paymentMethodLabel(order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)} · {paymentStateLabel(order.paymentState, order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)}</Text>
              </View>
              <BthwaniStatusBadge icon={badgeIcon} label={orderStateLabel(order.state)} tone={badgeTone} />
            </View>
            <Text style={styles.muted}>{order.fulfillmentMode === "CUSTOMER_PICKUP" ? "طريقة الاستلام: الاستلام من المتجر" : `العنوان: ${order.addressText}`}</Text>
            {order.fulfillmentMode !== "CUSTOMER_PICKUP" ? <View style={styles.handoff}>
              <Text style={styles.lineTitle}>{order.recipient.mode === "OTHER" ? "مستلم الطلب" : "المستلم: صاحب الطلب"}</Text>
              {order.recipient.mode === "OTHER" ? <>
                <Text selectable style={styles.muted}>{order.recipient.name}</Text>
                <Text selectable style={styles.muted}>{order.recipient.phoneE164}</Text>
                {order.recipient.instructions ? <Text style={styles.muted}>تعليمات التوصيل: {order.recipient.instructions}</Text> : null}
              </> : null}
            </View> : null}
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
            {canFulfillOrder(order.storeId) && assignment ? <View style={styles.handoff}><BthwaniStatusBadge icon={assignment.handoff.state === "completed" ? "success" : "deliveries"} label={`تسليم المتجر: ${captainHandoffStateLabel(assignment.handoff.state)}`} tone={assignment.handoff.state === "completed" ? "success" : "warning"} />{assignment.handoff.state === "pending" ? <BthwaniButton busy={busy === order.id} disabled={actionDisabled} label="تأكيد جاهزية التسليم" onPress={() => void confirmHandoff(order, assignment)} /> : null}</View> : null}
            {canFulfillOrder(order.storeId) && order.fulfillmentMode === "PARTNER_CAPTAIN" && order.state === "READY_FOR_DISPATCH" ? <View style={styles.handoff} accessibilityLabel="إسناد طلب التوصيل إلى كابتن المتجر"><Text style={styles.lineTitle}>إسناد الطلب إلى كابتن المتجر</Text>{dispatchOffer?.state === "offered" ? <Text style={styles.muted}>أُرسل الطلب إلى {dispatchOffer.captainActorId} وبانتظار قبوله.</Text> : <>{dispatchOffer ? <Text style={styles.muted}>{dispatchOffer.state === "rejected" ? "رفض الكابتن العرض. يمكنك إرساله إلى كابتن آخر." : "انتهت مهلة العرض. يمكنك إرساله إلى كابتن آخر."}</Text> : null}{(storeCaptainActorIDsByStore[order.storeId] ?? []).length ? (storeCaptainActorIDsByStore[order.storeId] ?? []).map((captainActorId) => <BthwaniButton key={captainActorId} busy={busy === order.id} disabled={actionDisabled} label={`إرسال الطلب إلى ${captainActorId}`} onPress={() => void dispatchToStoreCaptain(order, captainActorId)} variant="secondary" />) : <Text style={styles.muted}>لا يوجد كابتن نشط مرتبط بهذا المتجر. أرسل دعوة للكابتن واطلب منه قبولها في تطبيق الكابتن.</Text>}</>}</View> : null}
            {order.state === "READY_FOR_PICKUP" ? <View style={styles.pickupConfirmation}><TextInput accessibilityLabel="رمز الاستلام الذي قدمه العميل" editable={!actionDisabled} keyboardType="number-pad" maxLength={6} onChangeText={(value) => setPickupCodes((current) => ({ ...current, [order.id]: toAsciiDigits(value).replace(/[^0-9]/g, "").slice(0, 6) }))} placeholder="رمز الاستلام من العميل" placeholderTextColor={theme.colorMuted} style={styles.pickupCodeInput} textAlign="center" value={pickupCodes[order.id] ?? ""} /><BthwaniButton busy={busy === order.id} disabled={actionDisabled || toAsciiDigits(pickupCodes[order.id] ?? "").length !== 6} label="تأكيد استلام العميل" onPress={() => void confirmStorePickup(order)} />{order.fulfillmentMode === "CUSTOMER_PICKUP" && order.paymentMethod === "CASH_AT_STORE" && order.paymentState === "REQUIRES_COLLECTION" ? <BthwaniButton disabled={actionDisabled} label="العميل لم يحضر" onPress={() => markPickupNoShow(order)} variant="danger" /> : null}</View> : null}
            {canFulfillOrder(order.storeId) && order.fulfillmentMode === "PARTNER_CAPTAIN" && order.state === "DELIVERED" ? <View style={styles.pickupConfirmation}><Text style={styles.lineTitle}>تسوية طلب توصيل المتجر</Text>{settlementContent}</View> : null}
            {next ? <View style={styles.actionRow}>{hasOpenAdjustments && (next === "READY_FOR_DISPATCH" || next === "READY_FOR_PICKUP") ? <Text style={styles.error}>لا يمكن تجهيز الطلب للتسليم قبل حسم التعديل والتسوية المالية.</Text> : null}<BthwaniButton busy={busy === order.id} disabled={actionDisabled || (hasOpenAdjustments && (next === "READY_FOR_DISPATCH" || next === "READY_FOR_PICKUP"))} label={nextActionLabel} onPress={() => void transition(order)} style={styles.actionButton} />{next === "PARTNER_ACCEPTED" ? <BthwaniButton disabled={actionDisabled} label="رفض الطلب" onPress={() => void transition(order, "REJECTED")} style={styles.actionButton} variant="danger" /> : null}</View> : null}
            <OrderConversation orderId={order.id} />
          </View>
        );
      })}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {hasMore ? <BthwaniButton busy={loadingMore} disabled={loading || loadingMore || Boolean(busy)} label="تحميل طلبات أكثر" onPress={() => void load({ append: true, cursor })} variant="secondary" /> : null}
      <BthwaniButton busy={loading || Boolean(busy)} disabled={loading || Boolean(busy)} label="تحديث الطلبات" onPress={() => void load()} variant="secondary" />
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
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%" },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    summaryRow: { flexDirection: "row-reverse", gap: spacing[2] },
    summaryCard: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, flex: 1, gap: spacing[1], padding: spacing[2] },
    summaryValue: { ...typography.titleSm, color: theme.actionBackground },
    summaryLabel: { ...typography.label, color: theme.colorMuted, textAlign: "center" },
    filterRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing[1] },
    order: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2] },
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
    actionRow: { flexDirection: "row", gap: spacing[2] },
    orderTitle: { ...typography.bodyStrong, color: theme.color },
    orderHeaderCopy: { flex: 1, gap: spacing[1] },
    orderHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
    actionButton: { flex: 1 },
    error: { ...typography.label, color: theme.danger },
  });
}
