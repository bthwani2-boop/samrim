import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAssignment, type CaptainOffer, captainHandoffStateLabel, createDshMobileClient, formatMoney, formatOrderDate, formatQuantity, type Order, type OrderTransitionRequest, orderStateLabel, paymentMethodLabel, paymentStateLabel, type StoreCaptainMembership } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  { key: "ALL", label: "الكل" },
  { key: "NEEDS_ACTION", label: "تحتاج إجراء" },
  { key: "PREPARING", label: "قيد التجهيز" },
  { key: "HANDOFF", label: "التسليم" },
  { key: "CLOSED", label: "مغلقة" },
] as const;

type QueueFilter = (typeof queueFilters)[number]["key"];
type OrderQueue = Exclude<QueueFilter, "ALL">;

function queueForOrder(order: Order): OrderQueue {
  if (order.state === "CREATED") return "NEEDS_ACTION";
  if (order.state === "PARTNER_ACCEPTED" || order.state === "PREPARING") return "PREPARING";
  if (order.state === "READY_FOR_DISPATCH" || order.state === "READY_FOR_PICKUP" || order.state === "CAPTAIN_ASSIGNED" || order.state === "IN_CUSTODY") return "HANDOFF";
  return "CLOSED";
}

function matchesQuery(order: Order, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  const searchableText = [
    order.id,
    order.addressText,
    ...order.lines.flatMap((line) => [line.productName, line.variantTitle]),
  ].join(" ").toLocaleLowerCase();
  return searchableText.includes(normalizedQuery);
}

export function OrderManagement({ storeId }: { storeId: string }) {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { q: rawQuery } = useLocalSearchParams<{ q?: string | string[] }>();
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([]);
  const [assignments, setAssignments] = useState<Readonly<Record<string, CaptainAssignment>>>({});
  const [storeCaptainActorIDs, setStoreCaptainActorIDs] = useState<ReadonlyArray<string>>([]);
  const [dispatchOffers, setDispatchOffers] = useState<Readonly<Record<string, CaptainOffer>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("ALL");
  const [pickupCodes, setPickupCodes] = useState<Readonly<Record<string, string>>>({});

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const [orderResponse, membershipResponse] = await Promise.all([
        client().listStoreOrders(token, storeId),
        client().listPartnerStoreCaptainMemberships(token, storeId),
      ]);
      const nextOrders = orderResponse.orders;
      const entries = await Promise.all(nextOrders.filter((order) => order.state === "CAPTAIN_ASSIGNED" || order.state === "IN_CUSTODY").map(async (order) => {
        try { return [order.id, (await client().readStoreCaptainAssignment(token, storeId, order.id)).assignment] as const; }
        catch (cause) {
          if (cause && typeof cause === "object" && (cause as { kind?: unknown }).kind === "http" && (cause as { status?: unknown }).status === 404) return null;
          throw cause;
        }
      }));
      const offerEntries = await Promise.all(nextOrders.filter((order) => order.fulfillmentMode === "PARTNER_CAPTAIN" && order.state === "READY_FOR_DISPATCH").map(async (order) => {
        try { return [order.id, (await client().readPartnerStoreCaptainDispatchOffer(token, storeId, order.id)).offer] as const; }
        catch (cause) {
          if (cause && typeof cause === "object" && (cause as { kind?: unknown }).kind === "http" && (cause as { status?: unknown }).status === 404) return null;
          throw cause;
        }
      }));
      setOrders(nextOrders);
      setAssignments(Object.fromEntries(entries.filter((entry): entry is readonly [string, CaptainAssignment] => entry !== null)));
      setStoreCaptainActorIDs(membershipResponse.memberships.flatMap((membership: StoreCaptainMembership) => membership.state === "active" && membership.captainActorId ? [membership.captainActorId] : []));
      setDispatchOffers(Object.fromEntries(offerEntries.filter((entry): entry is readonly [string, CaptainOffer] => entry !== null)));
    } catch (cause) { console.error("DSH order list failed", cause); setError("تعذر قراءة الطلبات. أعد المحاولة."); }
    finally { setLoading(false); }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);
  const filteredOrders = useMemo(() => orders.filter((order) => (filter === "ALL" || queueForOrder(order) === filter) && matchesQuery(order, searchQuery)), [filter, orders, searchQuery]);
  const queueCounts = useMemo(() => Object.fromEntries(queueFilters.map(({ key }) => [key, key === "ALL" ? orders.length : orders.filter((order) => queueForOrder(order) === key).length])) as Record<QueueFilter, number>, [orders]);

  async function transition(order: Order, requestedState = nextState(order)) {
    if (!requestedState || busy || loading) return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().transitionStoreOrder(token, storeId, order.id, { state: requestedState }, order.version); await load(); }
    catch (cause) { console.error("DSH order transition failed", cause); setError("تعذر تحديث حالة الطلب. أعد القراءة ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  async function confirmStorePickup(order: Order) {
    const code = toAsciiDigits(pickupCodes[order.id] ?? "").trim();
    if (!/^\d{6}$/.test(code) || busy || loading || order.state !== "READY_FOR_PICKUP") return;
    setBusy(order.id); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().transitionStoreOrder(token, storeId, order.id, { state: "PICKED_UP", code }, order.version);
      setPickupCodes((current) => ({ ...current, [order.id]: "" }));
      await load();
    } catch (cause) { console.error("DSH store pickup confirmation failed", cause); setError("تعذر تأكيد رمز الاستلام. تحقق من الرمز ثم حدّث الطلب قبل إعادة المحاولة."); }
    finally { setBusy(""); }
  }

  async function confirmStoreCaptainCashHandoff(order: Order) {
    if (busy || loading || order.fulfillmentMode !== "PARTNER_CAPTAIN" || order.state !== "DELIVERED" || order.storeCashHandoffState !== "AWAITING_STORE_HANDOFF") return;
    setBusy(order.id); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().confirmPartnerCaptainCashHandoff(token, storeId, order.id, order.version);
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
    if (busy || loading || assignment.handoff.state !== "pending") return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().confirmCaptainStoreHandoff(token, storeId, order.id, assignment.id, assignment.handoff.version); await load(); }
    catch (cause) { console.error("DSH Captain handoff failed", cause); setError("تعذر تأكيد جاهزية التسليم. أعد القراءة ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  async function dispatchToStoreCaptain(order: Order, captainActorId: string) {
    if (busy || loading || order.fulfillmentMode !== "PARTNER_CAPTAIN" || order.state !== "READY_FOR_DISPATCH" || dispatchOffers[order.id]?.state === "offered") return;
    setBusy(order.id); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().createPartnerStoreCaptainDispatchOffer(token, storeId, order.id, { captainActorId }, order.version);
      setDispatchOffers((current) => ({ ...current, [order.id]: result.offer }));
      await load();
    } catch (cause) { console.error("DSH Store Captain dispatch failed", cause); setError("تعذر إرسال الطلب إلى كابتن المتجر. أعد قراءة الطلبات والعضويات ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  return (
    <View style={styles.container} accessibilityLabel="إدارة طلبات المتجر">
      <Text style={styles.title}>طلبات المتجر</Text>
      <Text style={styles.muted}>تابع الطلبات حسب ما يحتاج إجراءً الآن، ثم افتح تفاصيل المنتجات عند الحاجة.</Text>

      {!loading && orders.length ? (
        <View style={styles.summaryRow} accessibilityLabel="ملخص طابور الطلبات">
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{queueCounts.ALL}</Text><Text style={styles.summaryLabel}>كل الطلبات</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{queueCounts.NEEDS_ACTION}</Text><Text style={styles.summaryLabel}>تحتاج إجراء</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{queueCounts.HANDOFF}</Text><Text style={styles.summaryLabel}>التسليم</Text></View>
        </View>
      ) : null}

      <View style={styles.filterRow} accessibilityLabel="تصفية طلبات المتجر">
        {queueFilters.map(({ key, label }) => <BthwaniChip key={key} disabled={loading || Boolean(busy)} label={`${label} (${queueCounts[key]})`} onPress={() => setFilter(key)} selected={filter === key} />)}
      </View>

      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة طلبات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الطلبات…</Text></View> : null}
      {!loading && !orders.length ? <Text style={styles.muted}>لا توجد طلبات جديدة.</Text> : null}
      {!loading && orders.length > 0 && !filteredOrders.length ? <View style={styles.state}><Text style={styles.muted}>لا توجد طلبات مطابقة لهذا البحث أو التصنيف.</Text><BthwaniButton disabled={Boolean(busy)} label="عرض كل الطلبات" onPress={() => { setFilter("ALL"); router.setParams({ q: "" }); }} variant="secondary" /></View> : null}

      {filteredOrders.map((order) => {
        const next = nextState(order);
        const assignment = assignments[order.id];
        const dispatchOffer = dispatchOffers[order.id];
        const actionDisabled = loading || Boolean(busy);
        return (
          <View key={order.id} style={styles.order}>
            <View style={styles.orderHeader}>
              <View style={styles.orderHeaderCopy}>
                <Text style={styles.orderTitle}>طلب بتاريخ {formatOrderDate(order.createdAt)}</Text>
                <Text style={styles.muted}>{order.lines.length} منتج · {formatMoney(order.totalAmountMinor, order.currency)}</Text><Text style={styles.payment}>{paymentMethodLabel(order.paymentMethod, order.fulfillmentMode)} · {paymentStateLabel(order.paymentState, order.paymentMethod, order.fulfillmentMode)}</Text>
              </View>
              <BthwaniStatusBadge icon={order.state === "REJECTED" ? "warning" : order.state === "READY_FOR_DISPATCH" || order.state === "READY_FOR_PICKUP" || order.state === "PICKED_UP" ? "success" : "orders"} label={orderStateLabel(order.state)} tone={order.state === "REJECTED" ? "danger" : order.state === "READY_FOR_DISPATCH" || order.state === "READY_FOR_PICKUP" || order.state === "PICKED_UP" ? "success" : "info"} />
            </View>
            <Text style={styles.muted}>{order.fulfillmentMode === "CUSTOMER_PICKUP" ? "طريقة الاستلام: الاستلام من المتجر" : `العنوان: ${order.addressText}`}</Text>
            <View style={styles.lines}>
              {order.lines.map((line) => <View key={line.id} style={styles.line}><Text style={styles.lineTitle}>{line.productName} · {line.variantTitle}</Text><Text style={styles.muted}>المطلوب: {formatQuantity(line.baseUnit, line.requestedQuantityBaseUnits)} · النهائي: {formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)}</Text><Text style={styles.muted}>{pricingBasisLabel(line.pricingBasis)} · {formatMoney(line.lineAmountMinor, line.currency)}{line.modifierAmountMinor > 0 ? ` · الإضافات: ${formatMoney(line.modifierAmountMinor, line.currency)}` : ""}</Text>{line.modifierSnapshots.length ? <Text style={styles.muted}>الإضافات المحددة: {line.modifierSnapshots.map((modifier) => modifier.optionNameAr).join("، ")}</Text> : null}{line.attributeSnapshots.length ? <Text style={styles.muted}>تفاصيل المنتج: {line.attributeSnapshots.map((attribute) => `${attribute.code}: ${attributeSnapshotValue(attribute)}`).join("، ")}</Text> : null}</View>)}
            </View>
            {assignment ? <View style={styles.handoff}><BthwaniStatusBadge icon={assignment.handoff.state === "completed" ? "success" : "deliveries"} label={`تسليم المتجر: ${captainHandoffStateLabel(assignment.handoff.state)}`} tone={assignment.handoff.state === "completed" ? "success" : "warning"} />{assignment.handoff.state === "pending" ? <BthwaniButton busy={busy === order.id} disabled={actionDisabled} label="تأكيد جاهزية التسليم" onPress={() => void confirmHandoff(order, assignment)} /> : null}</View> : null}
            {order.fulfillmentMode === "PARTNER_CAPTAIN" && order.state === "READY_FOR_DISPATCH" ? <View style={styles.handoff} accessibilityLabel="إسناد طلب التوصيل إلى كابتن المتجر"><Text style={styles.lineTitle}>إسناد الطلب إلى كابتن المتجر</Text>{dispatchOffer?.state === "offered" ? <Text style={styles.muted}>أُرسل الطلب إلى {dispatchOffer.captainActorId} وبانتظار قبوله.</Text> : <>{dispatchOffer ? <Text style={styles.muted}>{dispatchOffer.state === "rejected" ? "رفض الكابتن العرض. يمكنك إرساله إلى كابتن آخر." : "انتهت مهلة العرض. يمكنك إرساله إلى كابتن آخر."}</Text> : null}{storeCaptainActorIDs.length ? storeCaptainActorIDs.map((captainActorId) => <BthwaniButton key={captainActorId} busy={busy === order.id} disabled={actionDisabled} label={`إرسال الطلب إلى ${captainActorId}`} onPress={() => void dispatchToStoreCaptain(order, captainActorId)} variant="secondary" />) : <Text style={styles.muted}>لا يوجد كابتن نشط مرتبط بهذا المتجر. أرسل دعوة للكابتن واطلب منه قبولها في تطبيق الكابتن.</Text>}</>}</View> : null}
            {order.state === "READY_FOR_PICKUP" ? <View style={styles.pickupConfirmation}><TextInput accessibilityLabel="رمز الاستلام الذي قدمه العميل" editable={!actionDisabled} keyboardType="number-pad" maxLength={6} onChangeText={(value) => setPickupCodes((current) => ({ ...current, [order.id]: toAsciiDigits(value).replace(/[^0-9]/g, "").slice(0, 6) }))} placeholder="رمز الاستلام من العميل" placeholderTextColor={theme.colorMuted} style={styles.pickupCodeInput} textAlign="center" value={pickupCodes[order.id] ?? ""} /><BthwaniButton busy={busy === order.id} disabled={actionDisabled || toAsciiDigits(pickupCodes[order.id] ?? "").length !== 6} label="تأكيد استلام العميل" onPress={() => void confirmStorePickup(order)} />{order.fulfillmentMode === "CUSTOMER_PICKUP" && order.paymentMethod === "CASH_AT_STORE" && order.paymentState === "REQUIRES_COLLECTION" ? <BthwaniButton disabled={actionDisabled} label="العميل لم يحضر" onPress={() => markPickupNoShow(order)} variant="danger" /> : null}</View> : null}
            {order.fulfillmentMode === "PARTNER_CAPTAIN" && order.state === "DELIVERED" ? <View style={styles.pickupConfirmation}><Text style={styles.lineTitle}>تسوية نقد توصيل المتجر</Text>{order.storeCashHandoffState === "AWAITING_STORE_HANDOFF" ? <><Text style={styles.muted}>استلم من الكابتن مبلغ الطلب نقدًا: {formatMoney(order.totalAmountMinor, order.currency)}. لن تُسجل العمولة حتى تؤكد الاستلام الفعلي.</Text><BthwaniButton busy={busy === order.id} disabled={actionDisabled} label="أكد استلام النقد من الكابتن" onPress={() => void confirmStoreCaptainCashHandoff(order)} /></> : order.storeCashHandoffState === "STORE_CONFIRMED" ? <Text style={styles.muted}>أكدت استلام النقد. جارٍ تسجيل التحصيل والعمولة.</Text> : order.storeCashHandoffState === "SETTLED" ? <Text style={styles.muted}>تم تأكيد التحصيل من المتجر وتسوية عمولة المنصة.</Text> : <Text style={styles.muted}>ينتظر النظام تسجيل اكتمال تسليم الكابتن.</Text>}</View> : null}
            {next ? <View style={styles.actionRow}><BthwaniButton busy={busy === order.id} disabled={actionDisabled} label={next === "PARTNER_ACCEPTED" ? "قبول الطلب" : next === "PREPARING" ? "بدء التجهيز" : next === "READY_FOR_PICKUP" ? "جاهز للاستلام" : "جاهز للتسليم"} onPress={() => void transition(order)} style={styles.actionButton} />{next === "PARTNER_ACCEPTED" ? <BthwaniButton disabled={actionDisabled} label="رفض الطلب" onPress={() => void transition(order, "REJECTED")} style={styles.actionButton} variant="danger" /> : null}</View> : null}
            <OrderConversation orderId={order.id} />
          </View>
        );
      })}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={loading || Boolean(busy)} disabled={loading || Boolean(busy)} label="تحديث الطلبات" onPress={() => void load()} variant="secondary" />
    </View>
  );
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
