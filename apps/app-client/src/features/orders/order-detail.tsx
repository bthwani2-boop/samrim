import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniMap, BthwaniSectionHeader, BthwaniSkeleton, BthwaniStatusBadge, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, type DeliveryProofResponse, formatMoney, formatOrderDate, formatQuantity, type Order, type OrderRatingResponse, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { OrderConversation } from "./order-conversation";
import { isClientOrderScopeCurrent } from "./order-session-scope";

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

function hasCurrentClientActor(actorID: string): boolean {
  const session = currentIdentityState();
  return session.kind === "authenticated" && actorID.length > 0 && session.identity.subject.trim() === actorID;
}

export default function ClientOrderDetail() {
  const { orderId: rawOrderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = Array.isArray(rawOrderId) ? rawOrderId[0] ?? "" : rawOrderId ?? "";
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; order: Order; actorID: string } | { kind: "error" } | { kind: "auth_required" }>({ kind: "loading" });
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const loadSequence = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [adjustmentBusy, setAdjustmentBusy] = useState("");
  const [adjustmentError, setAdjustmentError] = useState("");
  const [deliveryProof, setDeliveryProof] = useState<{ kind: "loading" } | { kind: "ready"; value: DeliveryProofResponse } | { kind: "error" }>({ kind: "loading" });
  const [orderRating, setOrderRating] = useState<{ kind: "hidden" | "loading" } | { kind: "ready"; value: OrderRatingResponse } | { kind: "empty" } | { kind: "error" }>({ kind: "hidden" });
  const [selectedRating, setSelectedRating] = useState(0);
  const [review, setReview] = useState("");
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState("");

  const refreshDeliveryProof = useCallback(async () => {
    const session = currentIdentityState();
    if (!orderId.trim() || session.kind !== "authenticated") return;
    const actorID = session.identity.subject.trim();
    try {
      const token = await getUsableIdentityAccessToken();
      const value = await client().readClientDeliveryProof(token, orderId);
      if (hasCurrentClientActor(actorID)) setDeliveryProof({ kind: "ready", value });
    } catch (error) {
      console.error("DSH client delivery proof read failed", error);
      if (hasCurrentClientActor(actorID)) setDeliveryProof({ kind: "error" });
    }
  }, [orderId]);

  const refreshRating = useCallback(async (orderState: Order["state"]) => {
    const session = currentIdentityState();
    if (session.kind !== "authenticated") return;
    const actorID = session.identity.subject.trim();
    if (!orderId.trim() || (orderState !== "DELIVERED" && orderState !== "PICKED_UP")) {
      setOrderRating({ kind: "hidden" });
      return;
    }
    setOrderRating({ kind: "loading" });
    setRatingError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const value = await client().readClientOrderRating(token, orderId);
      if (!hasCurrentClientActor(actorID)) return;
      setSelectedRating(value.rating.rating);
      setReview(value.rating.review);
      setOrderRating({ kind: "ready", value });
    } catch (error) {
      if (!hasCurrentClientActor(actorID)) return;
      if (typeof error === "object" && error !== null && "status" in error && (error as { status?: unknown }).status === 404) {
        setSelectedRating(0);
        setReview("");
        setOrderRating({ kind: "empty" });
        return;
      }
      console.error("DSH client order rating read failed", error);
      setOrderRating({ kind: "error" });
    }
  }, [orderId]);

  const load = useCallback(async (preserveCurrent = false) => {
    const sequence = ++loadSequence.current;
    const session = currentIdentityState();
    if (session.kind !== "authenticated" || !session.identity.subject.trim()) { setState({ kind: "auth_required" }); return; }
    const actorID = session.identity.subject.trim();
    if (!orderId.trim()) { setState({ kind: "error" }); return; }
    if (preserveCurrent) setRefreshing(true);
    else setState({ kind: "loading" });
    setRefreshError("");
    setCancelError("");
    setDeliveryProof({ kind: "loading" });
    setOrderRating({ kind: "loading" });
    try {
      const token = await getUsableIdentityAccessToken();
      const order = (await client().readOrder(token, orderId)).order;
      const current = currentIdentityState();
      if (sequence !== loadSequence.current || current.kind !== "authenticated" || !isClientOrderScopeCurrent(actorID, order.id, current.identity.subject.trim(), orderId)) return;
      setState({ kind: "ready", order, actorID });
      await refreshDeliveryProof();
      if (sequence !== loadSequence.current || !hasCurrentClientActor(actorID)) return;
      if (sequence !== loadSequence.current || !hasCurrentClientActor(actorID)) return;
      await refreshRating(order.state);
    } catch (error) {
      console.error("DSH client order detail read failed", error);
      const current = currentIdentityState();
      if (sequence !== loadSequence.current || current.kind !== "authenticated" || current.identity.subject.trim() !== actorID) return;
      if (preserveCurrent) setRefreshError("تعذر تحديث الحالة. أعد القراءة قبل اتخاذ قرار جديد.");
      else setState({ kind: "error" });
    } finally {
      if (sequence === loadSequence.current) setRefreshing(false);
    }
  }, [orderId, refreshDeliveryProof, refreshRating]);

  const submitRating = useCallback(async () => {
    if (state.kind !== "ready" || !isClientOrderScopeCurrent(state.actorID, state.order.id, activeActorID, orderId) || !hasCurrentClientActor(state.actorID) || (state.order.state !== "DELIVERED" && state.order.state !== "PICKED_UP") || selectedRating < 1 || ratingSubmitting) return;
    setRatingSubmitting(true);
    setRatingError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const value = await client().createClientOrderRating(token, state.order.id, { rating: selectedRating, review }, state.order.version);
      if (!hasCurrentClientActor(state.actorID)) return;
      setOrderRating({ kind: "ready", value });
      setReview(value.rating.review);
    } catch (error) {
      console.error("DSH client order rating create failed", error);
      if (hasCurrentClientActor(state.actorID)) setRatingError("تعذر حفظ التقييم. قد تكون العملية سُجلت بالفعل؛ حدّث الحالة للتحقق.");
    } finally {
      setRatingSubmitting(false);
    }
  }, [activeActorID, orderId, ratingSubmitting, review, selectedRating, state]);

  const cancelOrder = useCallback(async () => {
    if (state.kind !== "ready" || !isClientOrderScopeCurrent(state.actorID, state.order.id, activeActorID, orderId) || !hasCurrentClientActor(state.actorID) || state.order.state !== "CREATED" || cancelling) return;
    setCancelling(true);
    setCancelError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().cancelClientOrder(token, state.order.id, state.order.version);
      if (!hasCurrentClientActor(state.actorID) || result.order.id !== orderId) return;
      setState({ kind: "ready", order: result.order, actorID: state.actorID });
    } catch (error) {
      console.error("DSH client order cancellation failed", error);
      if (hasCurrentClientActor(state.actorID)) setCancelError("تعذر إلغاء الطلب. ربما بدأ المتجر معالجته؛ حدّث الحالة وحاول مرة أخرى.");
    } finally {
      setCancelling(false);
    }
  }, [activeActorID, cancelling, orderId, state]);

  const decideAdjustment = useCallback(async (adjustmentId: string, decision: "ACCEPT" | "REJECT") => {
    if (state.kind !== "ready" || !isClientOrderScopeCurrent(state.actorID, state.order.id, activeActorID, orderId) || !hasCurrentClientActor(state.actorID) || adjustmentBusy) return;
    setAdjustmentBusy(adjustmentId);
    setAdjustmentError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().decideClientOrderAdjustment(token, state.order.id, adjustmentId, { decision, expectedAdjustmentVersion: state.order.adjustments.find((item) => item.id === adjustmentId)?.version ?? 0 }, state.order.version);
      if (!hasCurrentClientActor(state.actorID) || result.order.id !== orderId) return;
      setState({ kind: "ready", order: result.order, actorID: state.actorID });
    } catch (error) {
      console.error("DSH client order adjustment decision failed", error);
      if (hasCurrentClientActor(state.actorID)) setAdjustmentError("تعذر حفظ قرارك. حدّث الطلب للتحقق من الحالة قبل إعادة المحاولة.");
    } finally {
      setAdjustmentBusy("");
    }
  }, [activeActorID, adjustmentBusy, orderId, state]);

  function confirmAdjustmentDecision(adjustmentId: string, decision: "ACCEPT" | "REJECT") {
    if (decision === "REJECT") {
      Alert.alert("رفض التعديل", "سيبقى الطلب كما هو، وقد يحتاج المتجر إلى التواصل معك أو إلغاء الطلب إذا تعذر توفير الصنف.", [
        { text: "رجوع", style: "cancel" },
        { text: "رفض التعديل", style: "destructive", onPress: () => void decideAdjustment(adjustmentId, decision) },
      ]);
      return;
    }
    Alert.alert("الموافقة على التعديل", "تُسجل موافقتك على تغيير الصنف أو كميته فقط. يبقى إجمالي الطلب الأصلي محفوظًا ولا ينفذ النظام استردادًا أو تحصيلًا إضافيًا حتى تكتمل التسوية المالية.", [
      { text: "مراجعة لاحقًا", style: "cancel" },
      { text: "موافقة مع تعليق الطلب للتسوية", onPress: () => void decideAdjustment(adjustmentId, decision) },
    ]);
  }

  function requestCancel() {
    Alert.alert("إلغاء الطلب", "سيتم إلغاء الطلب وإلغاء التحصيل النقدي. هل تريد المتابعة؟", [
      { text: "متابعة الطلب", style: "cancel" },
      { text: "إلغاء الطلب", style: "destructive", onPress: () => void cancelOrder() },
    ]);
  }

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

  useEffect(() => {
    if (state.kind !== "ready" || !isClientOrderScopeCurrent(state.actorID, state.order.id, activeActorID, orderId) || state.order.fulfillmentMode === "CUSTOMER_PICKUP" || ["DELIVERED", "DELIVERY_FAILED", "CANCELLED", "PICKED_UP"].includes(state.order.state)) return;
    const timer = setInterval(() => { void load(true); }, 60_000);
    return () => clearInterval(timer);
  }, [activeActorID, load, orderId, state]);

  if (state.kind === "ready" && !isClientOrderScopeCurrent(state.actorID, state.order.id, activeActorID, orderId)) return <View style={styles.state} accessibilityLabel="جارٍ التحقق من صاحب الطلب"><BthwaniSkeleton height={128} /><Text style={styles.muted}>جارٍ التحقق من الجلسة وملكية الطلب…</Text></View>;
  if (state.kind === "auth_required") return <View style={styles.state}><BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>سجّل الدخول لعرض تفاصيل الطلب</Text><Text style={styles.muted}>سجّل الدخول أولًا ثم افتح الطلب مرة أخرى.</Text><BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/orders" as Href)} /></View>;
  if (state.kind === "loading") return <View style={styles.state} accessibilityLabel="جارٍ تجهيز تفاصيل الطلب"><BthwaniSkeleton width="42%" height={28} /><BthwaniSkeleton height={128} /><BthwaniSkeleton height={180} /></View>;
  if (state.kind === "error") return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر قراءة تفاصيل الطلب</Text><Text style={styles.muted}>قد تكون الجلسة أو الطلب غير متاحين الآن.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /><BthwaniButton label="العودة إلى الطلبات" onPress={() => router.back()} variant="secondary" /></View>;

  const { order } = state;
  const isStorePickup = order.fulfillmentMode === "CUSTOMER_PICKUP";
  const proofLabel = isStorePickup ? "رمز الاستلام" : "تأكيد التسليم";
  const proofAvailableMessage = "أظهر الرمز لموظف المتجر بعد تجهيز طلبك." ;
  const proofWaitingMessage = isStorePickup ? "سيظهر رمز الاستلام بعد جاهزية الطلب." : "يؤكد الكابتن تسليم الطلب بعد وصوله للمستلم؛ لا تحتاج إلى رمز." ;
  const completedState = order.state === "DELIVERED" || order.state === "PICKED_UP";
  let statusIcon: "success" | "warning" | "orders" = "orders";
  let statusTone: "success" | "danger" | "info" = "info";
  if (order.state === "DELIVERED") {
    statusIcon = "success";
    statusTone = "success";
  } else if (order.state === "DELIVERY_FAILED" || order.state === "CANCELLED") {
    statusIcon = "warning";
    statusTone = "danger";
  }
  let paymentAmountCopy = "مغطى بالكامل من رصيد المحفظة";
  if (order.cashAmountMinor !== 0) {
    paymentAmountCopy = `النقد المتبقي عند الاستلام: ${formatMoney(order.cashAmountMinor, order.currency)}`;
  }
  return (
    <View style={styles.container} accessibilityLabel="تفاصيل الطلب">
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى الطلبات" onPress={() => router.back()} style={styles.backButton}><BthwaniIcon name="back" color={theme.interactiveText} size={sizing.iconMd} /><Text style={styles.back}>طلباتي</Text></Pressable>
      <BthwaniSurface tone="raised" style={styles.summary}>
        <View style={styles.summaryIcon}><BthwaniIcon name="orders" color={theme.onAction} size={sizing.iconXl} /></View>
        <View style={styles.summaryCopy}><Text style={styles.eyebrow}>طلبك</Text><Text style={styles.title}>طلب {formatOrderDate(order.createdAt)}</Text><Text style={styles.muted}>{isStorePickup ? `الاستلام من ${order.storeName}` : order.addressText}</Text></View>
      </BthwaniSurface>
      <View style={styles.status}><View style={styles.statusCopy}><Text style={styles.statusTitle}>الحالة الحالية</Text><BthwaniStatusBadge icon={statusIcon} label={orderStateLabel(order.state)} tone={statusTone} /><Text style={styles.statusTotal}>{formatMoney(order.totalAmountMinor, order.currency)}</Text><Text style={styles.payment}>{paymentAmountCopy}</Text><Text style={styles.payment}>{paymentMethodLabel(order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)} · {paymentStateLabel(order.paymentState, order.paymentMethod, order.fulfillmentMode, order.cashAmountMinor)}</Text></View><View style={styles.actionStack}><BthwaniButton accessibilityLabel="تحديث حالة الطلب" busy={refreshing} label="تحديث الحالة" onPress={() => void load(true)} variant="secondary" />{order.state === "CREATED" ? <BthwaniButton accessibilityLabel="إلغاء الطلب" busy={cancelling} disabled={cancelling || refreshing} label="إلغاء الطلب" onPress={requestCancel} variant="danger" /> : null}</View></View>
      {refreshError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{refreshError}</Text> : null}
      {cancelError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{cancelError}</Text> : null}
      {adjustmentError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{adjustmentError}</Text> : null}
      {order.adjustments.length ? <>
        <BthwaniSectionHeader title="تعديلات الطلب" subtitle="راجع التغيير المقترح قبل اتخاذ قرارك" />
        <View style={styles.adjustments}>{order.adjustments.map((adjustment) => {
          const line = order.lines.find((candidate) => candidate.id === adjustment.orderLineId);
          const proposed = adjustment.state === "PROPOSED";
          const stateLabel = adjustment.state === "PROPOSED" ? "بانتظار قرارك" : adjustment.state === "REJECTED" ? "رفضت التعديل" : "معلق حتى استكمال التسوية المالية";
          return <BthwaniSurface key={adjustment.id} tone="base" style={styles.adjustment}>
            <Text style={styles.lineTitle}>{adjustment.kind === "REMOVE_ITEM" ? "طلب إزالة صنف" : "تعديل الكمية المقاسة"}{line ? ` · ${line.productName}` : ""}</Text>
            {line && adjustment.actualQuantityBaseUnits ? <Text style={styles.muted}>الكمية المقترحة: {formatQuantity(line.baseUnit, adjustment.actualQuantityBaseUnits)} · الكمية المطلوبة: {formatQuantity(line.baseUnit, line.requestedQuantityBaseUnits)}</Text> : null}
            <BthwaniStatusBadge icon={proposed ? "warning" : adjustment.state === "REJECTED" ? "orders" : "warning"} label={stateLabel} tone={proposed || adjustment.state === "FINANCIAL_RECONCILIATION_REQUIRED" ? "warning" : "info"} />
            {proposed ? <><Text style={styles.muted}>الموافقة تسجل التغيير التشغيلي فقط. المبلغ الأصلي يبقى كما هو، ولا يتم استرداد أو تحصيل مبلغ حتى تُحسم التسوية.</Text><View style={styles.adjustmentActions}><BthwaniButton busy={adjustmentBusy === adjustment.id} disabled={Boolean(adjustmentBusy) || refreshing} label="موافقة مع تعليق الطلب للتسوية" onPress={() => confirmAdjustmentDecision(adjustment.id, "ACCEPT")} /><BthwaniButton disabled={Boolean(adjustmentBusy) || refreshing} label="رفض التعديل" onPress={() => confirmAdjustmentDecision(adjustment.id, "REJECT")} variant="secondary" /></View></> : adjustment.state === "FINANCIAL_RECONCILIATION_REQUIRED" ? <Text style={styles.muted}>وافق العميل على التغيير. لا يتقدم الطلب ولا يتغير المبلغ قبل اكتمال التسوية المالية المعتمدة.</Text> : null}
          </BthwaniSurface>;
        })}</View>
      </> : null}
      <OrderConversation orderId={order.id} />
      <BthwaniSectionHeader title={isStorePickup ? "رمز الاستلام الذاتي من المتجر" : "حالة التسليم"} subtitle={isStorePickup ? "أظهر الرمز لموظف المتجر عند استلامك الطلب" : "يسجل الكابتن تسليم الطلب، ويمكنك الإبلاغ عن أي مشكلة"} />
      <BthwaniSurface tone="base" style={styles.proofSurface}>
        {deliveryProof.kind === "loading" ? <Text style={styles.muted}>جارٍ تجهيز {proofLabel}…</Text> : null}
        {deliveryProof.kind === "error" ? <Text style={styles.refreshError}>تعذر قراءة {proofLabel} الآن. حدّث الحالة لإعادة المحاولة.</Text> : null}
        {deliveryProof.kind === "ready" && deliveryProof.value.state === "PENDING" ? <><Text style={styles.proofTitle}>{proofLabel}</Text>{isStorePickup && deliveryProof.value.code ? <Text accessibilityLabel={proofLabel} style={styles.proofCode}>{deliveryProof.value.code}</Text> : null}<Text style={styles.muted}>{isStorePickup && deliveryProof.value.code ? proofAvailableMessage : proofWaitingMessage}</Text></> : null}
        {deliveryProof.kind === "ready" && deliveryProof.value.state === "VERIFIED" ? <><BthwaniStatusBadge icon="success" label={isStorePickup ? "تم تأكيد الاستلام" : "تم إثبات التسليم بالرمز"} tone="success" /><Text style={styles.muted}>{isStorePickup ? "تم قبول رمز الاستلام وتسجيل استلامك للطلب." : "تم قبول رمز التسليم وتسجيل الاستلام."}</Text></> : null}
        {deliveryProof.kind === "ready" && deliveryProof.value.state === "CAPTAIN_CONFIRMED" ? <><BthwaniStatusBadge icon="success" label="أكد الكابتن تسليم الطلب" tone="success" /><Text style={styles.muted}>تأكيد الكابتن مسجل في النظام، وليس تحققًا مستقلًا برمز من العميل. يمكنك الإبلاغ عن أي اختلاف.</Text></> : null}
      </BthwaniSurface>
      {completedState ? <>
        <BthwaniSectionHeader title="تقييم المتجر" subtitle="قيّم المتجر الذي جهّز طلبك. تقييم المنتجات وجودة توصيل بثواني مستقلان عن تقييم المتجر." />
        <BthwaniSurface tone="base" style={styles.ratingSurface}>
          {orderRating.kind === "loading" ? <Text style={styles.muted}>جارٍ قراءة التقييم…</Text> : null}
          {orderRating.kind === "error" ? <Text style={styles.refreshError}>تعذر قراءة التقييم الآن. حدّث الحالة لإعادة المحاولة.</Text> : null}
          {orderRating.kind === "ready" ? <><BthwaniStatusBadge icon="success" label="تم حفظ تقييم المتجر" tone="success" /><Text style={styles.muted}>{"★".repeat(orderRating.value.rating.rating)}{"☆".repeat(5 - orderRating.value.rating.rating)}</Text>{orderRating.value.rating.review ? <Text style={styles.reviewText}>{orderRating.value.rating.review}</Text> : null}</> : null}
          {orderRating.kind === "empty" ? <>
            <Text style={styles.muted}>اختر من نجمة إلى خمس نجوم، ويمكنك إضافة ملاحظة قصيرة.</Text>
            <View accessibilityLabel="اختيار تقييم من نجمة إلى خمس نجوم" style={styles.ratingStars}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} نجوم`} onPress={() => setSelectedRating(value)} style={styles.ratingStar}><Text style={[styles.ratingStarText, value <= selectedRating ? styles.ratingStarSelected : null]}>{value <= selectedRating ? "★" : "☆"}</Text></Pressable>)}</View>
            <TextInput accessibilityLabel="مراجعة اختيارية" multiline maxLength={1000} onChangeText={setReview} placeholder="اكتب ملاحظتك (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.reviewInput} textAlign="right" value={review} />
            {ratingError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{ratingError}</Text> : null}
            <BthwaniButton busy={ratingSubmitting} disabled={selectedRating < 1 || ratingSubmitting} label="حفظ تقييم المتجر" onPress={() => void submitRating()} />
          </> : null}
        </BthwaniSurface>
      </> : null}
      {isStorePickup ? <>
        <BthwaniSectionHeader title="موقع الاستلام" />
        <BthwaniSurface tone="base" style={styles.pickupLocationSurface}>
          <Text style={styles.pickupLocationTitle}>{order.storeName}</Text>
          {order.pickupLocation ? <>
            <Text style={styles.muted}>هذا هو موقع الفرع الحالي للاستلام.</Text>
            <BthwaniMap accessibilityLabel={`خريطة موقع استلام ${order.storeName}`} markers={[{ id: "pickup", coordinate: order.pickupLocation, title: order.storeName }]} />
            <BthwaniButton accessibilityLabel={`فتح موقع ${order.storeName} على الخريطة`} label="الاتجاهات إلى المتجر" onPress={() => {
              const { latitude, longitude } = order.pickupLocation!;
              const mapUrl = `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodeURIComponent(order.storeName)})`;
              void Linking.openURL(mapUrl).catch(() => Alert.alert("تعذر فتح الخريطة", "يمكنك مراسلة المتجر من المحادثة للتأكد من نقطة الاستلام."));
            }} variant="secondary" />
          </> : <Text style={styles.muted}>موقع الفرع غير متاح على الخريطة حاليًا. راسل المتجر من المحادثة للتأكد من نقطة الاستلام.</Text>}
        </BthwaniSurface>
      </> : <>
        <BthwaniSectionHeader title="عنوان التوصيل" />
        <BthwaniSurface tone="base" style={styles.address}><BthwaniIcon name="location" color={theme.interactiveText} size={sizing.iconMd} /><Text style={styles.muted}>{order.addressText}</Text></BthwaniSurface>
      </>}
      <BthwaniSectionHeader title="مستلم الطلب" />
      <BthwaniSurface tone="base" style={styles.trackingSurface}>
        {order.recipient.mode === "OTHER" ? <>
          <Text style={styles.proofTitle}>{order.recipient.name}</Text>
          <Text selectable style={styles.muted}>رقم التواصل: {order.recipient.phoneE164}</Text>
          {order.recipient.instructions ? <Text style={styles.muted}>تعليمات التوصيل: {order.recipient.instructions}</Text> : null}
        </> : <Text style={styles.muted}>صاحب الطلب</Text>}
      </BthwaniSurface>
      <BthwaniSectionHeader title="المنتجات" subtitle={`${order.lines.length} ${order.lines.length === 1 ? "منتج" : "منتجات"}`} />
      <View style={styles.lines}>{order.lines.map((line) => <BthwaniSurface key={line.id} tone="base" style={styles.line}><View style={styles.lineTop}><Text style={styles.lineTitle} numberOfLines={2}>{line.productName}</Text><Text style={styles.linePrice}>{formatMoney(line.lineAmountMinor, line.currency)}</Text></View><Text style={styles.muted}>{formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)}{line.modifierSnapshots.length ? ` · ${line.modifierSnapshots.map((modifier) => modifier.optionNameAr).join("، ")}` : ""}</Text></BthwaniSurface>)}</View>
      <Text style={styles.muted}>تُقرأ حالة الطلب الحالية من الخدمة عند كل فتح.</Text>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    backButton: { alignItems: "center", flexDirection: "row", gap: spacing[1], minHeight: sizing.controlMd },
    back: { ...typography.body, color: theme.interactiveText },
    summary: { alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    summaryIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    summaryCopy: { flex: 1, gap: spacing[1] },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleMd, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    status: { backgroundColor: theme.actionSoft, borderRadius: radius.lg, gap: spacing[1], padding: spacing[4] },
    statusCopy: { flex: 1, gap: spacing[1] },
    statusTitle: { ...typography.caption, color: theme.colorMuted },
    statusValue: { ...typography.titleSm, color: theme.interactiveText },
    statusTotal: { ...typography.bodyStrong, color: theme.color },
    payment: { ...typography.bodySm, color: theme.interactiveText },
    actionStack: { gap: spacing[2] },
    address: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], padding: spacing[4] },
    pickupLocationSurface: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    pickupLocationTitle: { ...typography.bodyStrong, color: theme.color },
    lines: { gap: spacing[3] },
    adjustments: { gap: spacing[3] },
    adjustment: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    adjustmentActions: { gap: spacing[2] },
    line: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    lineTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    lineTitle: { ...typography.bodyStrong, color: theme.color, flex: 1 },
    linePrice: { ...typography.bodyStrong, color: theme.interactiveText },
    refreshError: { ...typography.bodySm, color: theme.danger },
    trackingSurface: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    trackingTitle: { ...typography.bodyStrong, color: theme.interactiveText },
    proofSurface: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    proofTitle: { ...typography.bodyStrong, color: theme.color },
    proofCode: { ...typography.titleLg, color: theme.interactiveText, letterSpacing: 6, textAlign: "center" },
    ratingSurface: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    ratingStars: { alignItems: "center", flexDirection: "row", justifyContent: "center" },
    ratingStar: { minHeight: sizing.controlMd, minWidth: sizing.controlMd, alignItems: "center", justifyContent: "center" },
    ratingStarText: { ...typography.titleLg, color: theme.colorMuted },
    ratingStarSelected: { color: theme.interactiveText },
    reviewInput: { ...typography.body, backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 120, padding: spacing[3] },
    reviewText: { ...typography.body, color: theme.color, textAlign: "right" },
  });
}
