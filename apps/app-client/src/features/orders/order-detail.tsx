import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniOrderChatSheet, BthwaniSectionHeader, BthwaniSkeleton, BthwaniStatusBadge, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { BthwaniMap } from "@bthwani/design-system/native/map";
import { cashCollectionPartyLabel, createDshMobileClient, type DeliveryProofResponse, formatMoney, formatOrderDate, formatQuantity, type Order, type OrderRatingResponse, type PublicStoreView, orderStateLabel, orderPaymentDisclosure } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PremiumOrderProgress, PremiumStoreIdentity, premiumColors } from "../order-experience/premium-order-ui";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { OrderConversation } from "./order-conversation";
import { clientOrderAuthenticationReturnPath, isClientOrderScopeCurrent } from "./order-session-scope";
import { orderJourneyPresentation } from "./order-journey";

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
  const { orderId: rawOrderId, chat: chatIntent } = useLocalSearchParams<{ orderId?: string | string[]; chat?: string }>();
  const orderId = Array.isArray(rawOrderId) ? rawOrderId[0] ?? "" : rawOrderId ?? "";
  const router = useRouter();
  const theme = useAppearanceTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; order: Order; actorID: string } | { kind: "error" } | { kind: "auth_required" }>({ kind: "loading" });
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const loadSequence = useRef(0);
  const latestOrderState = useRef<Order["state"] | null>(null);
  const [showCancellationForm, setShowCancellationForm] = useState(false);
  const [showConversation, setShowConversation] = useState(false);
  useEffect(()=>{if(chatIntent==="1")setShowConversation(true);},[chatIntent]);
  const [showAllItems, setShowAllItems] = useState(false);
  const [storeIdentity, setStoreIdentity] = useState<PublicStoreView | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancellationReview, setCancellationReview] = useState<{state: "PENDING" | "APPROVED" | "DECLINED"; decisionReason: string | null} | null>(null);
  const [cancellationReviewBusy, setCancellationReviewBusy] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
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

  const readCancellationReview = useCallback(async (token: string, requestedOrderID: string, actorID: string) => {
    try {
      const result = await client().readOrderCancellationReview(token, requestedOrderID);
      if (hasCurrentClientActor(actorID)) setCancellationReview(result.request);
    } catch (error) {
      if (hasCurrentClientActor(actorID) && typeof error === "object" && error !== null && "status" in error && (error as {status?:unknown}).status === 404) setCancellationReview(null);
    }
  }, []);

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
    if (!preserveCurrent) {
      setDeliveryProof({ kind: "loading" });
      setOrderRating({ kind: "loading" });
    }
    try {
      const token = await getUsableIdentityAccessToken();
      const order = (await client().readOrder(token, orderId)).order;
      const current = currentIdentityState();
      if (sequence !== loadSequence.current || current.kind !== "authenticated" || !isClientOrderScopeCurrent(actorID, order.id, current.identity.subject.trim(), orderId)) return;
      latestOrderState.current = order.state;
      setState({ kind: "ready", order, actorID });
      if (!["CANCELLED","DELIVERED","PICKED_UP","REJECTED"].includes(order.state)) void readCancellationReview(token,order.id,actorID);
      await refreshDeliveryProof();
      if (sequence !== loadSequence.current || !hasCurrentClientActor(actorID)) return;
      await refreshRating(order.state);
    } catch (error) {
      console.error("DSH client order detail read failed", error);
      const current = currentIdentityState();
      if (sequence !== loadSequence.current || current.kind !== "authenticated" || current.identity.subject.trim() !== actorID) return;
      if (preserveCurrent) console.warn("DSH order automatic refresh deferred", error);
      else setState({ kind: "error" });
    } finally {
      if (sequence === loadSequence.current) setRefreshing(false);
    }
  }, [orderId, readCancellationReview, refreshDeliveryProof, refreshRating]);

  const storeIdForMedia = state.kind === "ready" ? state.order.storeId : "";
  const cityIdForMedia = state.kind === "ready" ? state.order.serviceCityId : "";
  useEffect(() => {
    let current = true;
    setStoreIdentity(null);
    if (storeIdForMedia && cityIdForMedia) {
      void client().readPublishedStore(storeIdForMedia, cityIdForMedia)
        .then((store) => { if (current) setStoreIdentity(store); })
        .catch(() => { if (current) setStoreIdentity(null); });
    }
    return () => { current = false; };
  }, [storeIdForMedia, cityIdForMedia]);

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

  const requestOperationsCancellation = useCallback(async () => {
    if (state.kind !== "ready" || cancellationReviewBusy || cancellationReview?.state === "PENDING" ||
        !hasCurrentClientActor(state.actorID) || ["CANCELLED","REJECTED","DELIVERED","PICKED_UP"].includes(state.order.state)) return;
    setCancellationReviewBusy(true);
    setCancelError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().requestOrderCancellationReview(token, state.order.id, cancellationReason.trim(), Crypto.randomUUID());
      if (hasCurrentClientActor(state.actorID)) setCancellationReview(result.request);
    } catch {
      if (hasCurrentClientActor(state.actorID)) {
        const token = await getUsableIdentityAccessToken().catch(() => "");
        if (token) await readCancellationReview(token, state.order.id, state.actorID);
        setCancelError("لم تتأكد نتيجة طلب المراجعة. تحقق من الحالة قبل إعادة الإرسال.");
      }
    } finally { setCancellationReviewBusy(false); }
  }, [state, cancellationReviewBusy, cancellationReview?.state, cancellationReason, readCancellationReview]);

  const cancelOrder = useCallback(async () => {
    if (state.kind !== "ready" || !hasCurrentClientActor(state.actorID) || !isClientOrderScopeCurrent(state.actorID, state.order.id, activeActorID, orderId) || cancelling ||
      state.order.state !== "CREATED" || state.order.cancellationMode !== "CLIENT_BEFORE_ACCEPTANCE") return;
    setCancelling(true);
    setCancelError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const outcome = await client().cancelClientOrder(token, state.order.id, state.order.version);
      if (hasCurrentClientActor(state.actorID) && outcome.order.id === orderId) {
        setState({ kind: "ready", actorID: state.actorID, order: outcome.order });
      }
    } catch {
      if (hasCurrentClientActor(state.actorID)) {
        await load(true);
        setCancelError("تحقق من الحالة الحالية قبل أي محاولة إلغاء أخرى؛ قد تكون العملية سُجلت.");
      }
    } finally { setCancelling(false); }
  }, [activeActorID, cancelling, load, orderId, state]);

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

  useEffect(() => subscribeIdentitySession(setIdentityState), []);

  useFocusEffect(useCallback(() => {
    if (!activeActorID) {
      loadSequence.current += 1;
      latestOrderState.current = null;
      setState({ kind: "auth_required" });
      return;
    }
    void load();
    const isActive = () => latestOrderState.current != null &&
      !["DELIVERED", "DELIVERY_FAILED", "CANCELLED", "PICKED_UP", "REJECTED"].includes(latestOrderState.current);
    const timer = setInterval(() => {
      if (AppState.currentState === "active" && isActive()) void load(true);
    }, 30_000);
    const resume = AppState.addEventListener("change", next => {
      if (next === "active" && isActive()) void load(true);
    });
    return () => {
      clearInterval(timer);
      resume.remove();
    };
  }, [activeActorID, load]));

  if (state.kind === "ready" && !isClientOrderScopeCurrent(state.actorID, state.order.id, activeActorID, orderId)) return <View style={styles.state} accessibilityLabel="جارٍ التحقق من صاحب الطلب"><BthwaniSkeleton height={128} /><Text style={styles.muted}>جارٍ التحقق من الجلسة وملكية الطلب…</Text></View>;
  if (state.kind === "auth_required") return <View style={styles.state}><BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>سجّل الدخول لعرض تفاصيل الطلب</Text><Text style={styles.muted}>سجّل الدخول أولًا ثم افتح الطلب مرة أخرى.</Text><BthwaniButton label="تسجيل الدخول" onPress={() => router.replace(`/?returnTo=${encodeURIComponent(clientOrderAuthenticationReturnPath(orderId))}` as Href)} /></View>;
  if (state.kind === "loading") return <View style={styles.state} accessibilityLabel="جارٍ تجهيز تفاصيل الطلب"><BthwaniSkeleton width="42%" height={28} /><BthwaniSkeleton height={128} /><BthwaniSkeleton height={180} /></View>;
  if (state.kind === "error") return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر قراءة تفاصيل الطلب</Text><Text style={styles.muted}>قد تكون الجلسة أو الطلب غير متاحين الآن.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /><BthwaniButton label="العودة إلى الطلبات" onPress={() => router.back()} variant="secondary" /></View>;

  const { order } = state;
  const journey = orderJourneyPresentation(order);
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
  const paymentDisclosure = orderPaymentDisclosure(order);
  const walletAllocation = order.totalAmountMinor - order.cashAmountMinor;
  const cashDue = order.paymentState === "REQUIRES_COLLECTION" && !["CANCELLED", "REJECTED"].includes(order.state) && order.cashAmountMinor > 0;
  return (
    <View style={styles.container} accessibilityLabel="تفاصيل الطلب">
      <View style={styles.headerBar}>
        <Text style={styles.pageTitle}>متابعة الطلب</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى الطلبات" onPress={() => router.back()} style={styles.backButton}><BthwaniIcon name="back" color={theme.interactiveText} size={sizing.iconLg} /></Pressable>
      </View>
      <BthwaniSurface tone="raised" style={styles.hero}>
        <PremiumStoreIdentity compact title={order.storeName}
          subtitle={storeIdentity?.addressLine ?? formatOrderDate(order.createdAt)}
          imageUri={storeIdentity?.storeCoverImage?.uri ?? storeIdentity?.storeProfileImage?.uri}
          rating={storeIdentity && storeIdentity.ratingCount > 0 ? storeIdentity.ratingAverage.toFixed(1) + " (" + storeIdentity.ratingCount + ")" : undefined} />
        <View style={styles.heroStatus}>
          <BthwaniIcon name={isStorePickup ? "cart" : "orders"} color={theme.interactiveText} size={sizing.iconXl} />
          <Text accessibilityLiveRegion="polite" style={styles.heroTitle}>{journey.title}</Text>
        </View>
        <Text style={styles.muted} numberOfLines={1}>{journey.description}</Text>
        {order.customerNote ? <View style={styles.modeTag}>
          <Text style={styles.sectionTitle}>ملاحظات الطلب</Text>
          <Text style={styles.muted} numberOfLines={2}>{order.customerNote}</Text>
        </View> : null}
        <View style={styles.modeTag}><Text style={styles.modeTagText}>طريقة التنفيذ: {journey.fulfillmentLabel}</Text></View>
      </BthwaniSurface>
      <BthwaniSurface tone="raised" style={styles.journey}>
        {!journey.exception ? <PremiumOrderProgress steps={journey.steps} index={journey.currentStep} /> : null}
      </BthwaniSurface>
      {!isStorePickup ? <BthwaniSurface tone="raised" style={styles.deliveryOverview}>
        <View style={styles.courierHeading}>
          <BthwaniIcon name="orders" color={theme.interactiveText} size={sizing.iconLg} />
          <View style={styles.heroCopy}>
            <Text style={styles.sectionTitle}>{order.fulfillmentMode === "PARTNER_CAPTAIN" ? "توصيل المتجر" : "كابتن بثواني"}</Text>
            <Text style={styles.muted}>{order.state === "IN_CUSTODY" ? "خرج الطلب للتوصيل" : order.state === "CAPTAIN_ASSIGNED" ? "الكابتن مُسند" : "بانتظار بدء التوصيل"}</Text>
          </View>
        </View>
        {order.pickupLocation ? <BthwaniMap accessibilityLabel="موقع المتجر ووجهة الطلب دون تتبع مباشر للكابتن" markers={[
          { id: "store", title: order.storeName, coordinate: order.pickupLocation },
          { id: "destination", title: "عنوان التوصيل", coordinate: { latitude: order.addressLatitude, longitude: order.addressLongitude } },
        ]} /> : null}
        {order.state === "IN_CUSTODY" ? <Text style={styles.muted}>موقع المتجر ووجهتك · لا يوجد تتبع مباشر</Text> : null}
      </BthwaniSurface> : null}
      {((isStorePickup && ["READY_FOR_PICKUP", "PICKED_UP"].includes(order.state)) ||
        (!isStorePickup && ["IN_CUSTODY", "DELIVERED", "DELIVERY_FAILED"].includes(order.state)) ||
        (deliveryProof.kind === "ready" && deliveryProof.value.state !== "PENDING")) ? <>
      <BthwaniSectionHeader title={isStorePickup ? "رمز الاستلام" : "التسليم"} />
      <BthwaniSurface tone="base" style={styles.proofSurface}>
        {deliveryProof.kind === "loading" ? <Text style={styles.muted}>جارٍ تجهيز {proofLabel}…</Text> : null}
        {deliveryProof.kind === "error" ? <Text style={styles.refreshError}>تعذر عرض {proofLabel} حاليًا.</Text> : null}
        {deliveryProof.kind === "ready" && deliveryProof.value.state === "PENDING" ? <><Text style={styles.proofTitle}>{proofLabel}</Text>{isStorePickup && deliveryProof.value.code ? <Text accessibilityLabel={proofLabel} style={styles.proofCode}>{deliveryProof.value.code}</Text> : null}<Text style={styles.muted}>{isStorePickup && deliveryProof.value.code ? proofAvailableMessage : proofWaitingMessage}</Text></> : null}
        {deliveryProof.kind === "ready" && deliveryProof.value.state === "VERIFIED" ? <><BthwaniStatusBadge icon="success" label={isStorePickup ? "تم تأكيد الاستلام" : "تم إثبات التسليم بالرمز"} tone="success" /><Text style={styles.muted}>{isStorePickup ? "تم قبول رمز الاستلام وتسجيل استلامك للطلب." : "تم قبول رمز التسليم وتسجيل الاستلام."}</Text></> : null}
        {deliveryProof.kind === "ready" && deliveryProof.value.state === "CAPTAIN_CONFIRMED" ? <BthwaniStatusBadge icon="success" label="أكد الكابتن التسليم" tone="success" /> : null}
      </BthwaniSurface></> : null}
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
      <View style={styles.actions}>
        <View style={styles.action}><BthwaniButton label={showConversation ? "إغلاق المحادثة" : "محادثة الطلب"} variant="primary" onPress={() => setShowConversation((value) => !value)}/></View>
        <View style={styles.action}><BthwaniButton label="المساعدة" variant="secondary" onPress={() => Alert.alert("مساعدة الطلب", "يمكنك متابعة المشكلة عبر محادثة الطلب أو طلب مراجعة الإلغاء حين يكون متاحًا.", [{ text: "إغلاق", style: "cancel" }, { text: "مراسلة الطلب", onPress: () => setShowConversation(true) }, ...(order.state !== "CREATED" && !completedState && !["CANCELLED", "REJECTED"].includes(order.state) ? [{ text: "مراجعة الإلغاء", onPress: () => setShowCancellationForm(true) }] : []) ])}/></View>
      </View>
      <BthwaniOrderChatSheet visible={showConversation} bottomInset={insets.bottom} onClose={()=>setShowConversation(false)}
        orderReference={order.id.slice(-8)} status={orderStateLabel(order.state)}
        summary={order.storeName+" · "+order.lines.length+" أصناف"} quickFacts={order.lines.slice(0,2).map(line=>line.productName).join("، ")+(order.lines.length>2?"…":"")+" · "+journey.fulfillmentLabel}
        total={formatMoney(order.totalAmountMinor,order.currency)} details={[...order.lines.map(line=>({id:line.id,label:"صنف",value:line.productName})),{label:"التوصيل",value:journey.fulfillmentLabel},...(!isStorePickup?[{label:"العنوان",value:order.addressText}]:[]),...(order.customerNote?[{label:"ملاحظات",value:order.customerNote}]:[])]}>
        {showConversation?<OrderConversation orderId={order.id}/>:null}
      </BthwaniOrderChatSheet>
      <View style={styles.status}>
        <Text style={styles.sectionTitle}>ملخص الدفع</Text>
        {journey.exception ? <BthwaniStatusBadge icon={statusIcon} label={orderStateLabel(order.state)} tone={statusTone} /> : null}
        <View style={styles.amountRow}>
          <View style={styles.paymentColumn}><Text style={styles.muted}>الإجمالي</Text><Text style={styles.statusTotal}>{formatMoney(order.totalAmountMinor, order.currency)}</Text></View>
          <View style={styles.paymentColumn}><Text style={styles.muted}>{cashDue ? "المتبقي نقدًا" : "حالة الدفع"}</Text><Text style={styles.statusTotal}>{cashDue ? formatMoney(order.cashAmountMinor, order.currency) : walletAllocation > 0 && order.cashAmountMinor === 0 ? "محفظة بثواني" : paymentDisclosure.amount}</Text></View>
        </View>
        {cashDue ? <Text style={styles.muted}>التحصيل: {cashCollectionPartyLabel(order.fulfillmentMode)}</Text> : null}
        {order.state === "CANCELLED" && order.paymentState !== "CANCELLED" ? <Text style={styles.payment}>{paymentDisclosure.status}</Text> : null}
        {order.state === "CREATED" && order.cancellationMode === "CLIENT_BEFORE_ACCEPTANCE" ?
          <BthwaniButton accessibilityLabel="إلغاء الطلب" busy={cancelling} disabled={refreshing || cancelling}
            label="إلغاء الطلب" variant="secondary"
            onPress={() => Alert.alert("إلغاء الطلب", "هل تريد إلغاء طلبك قبل قبول المتجر؟",
              [{ text: "رجوع", style: "cancel" }, { text: "إلغاء الطلب", style: "destructive", onPress: () => void cancelOrder() }])} /> : null}
      </View>
      <Text style={styles.sectionTitle}>المنتجات ({order.lines.length})</Text>
      {order.lines.length > 2 ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAllItems }} onPress={() => setShowAllItems((value) => !value)} style={styles.itemsShowAll}><Text style={styles.itemsAction}>{showAllItems ? "إظهار عنصرين" : "عرض كل المنتجات"}</Text></Pressable> : null}
      <View style={styles.lines}>{order.lines.slice(0, showAllItems ? undefined : 2).map((line) => <BthwaniSurface key={line.id} tone="base" style={styles.line}><View style={styles.lineTop}><Text style={styles.lineTitle} numberOfLines={2}>{line.productName}</Text><Text style={styles.linePrice}>{formatMoney(line.lineAmountMinor, line.currency)}</Text></View><Text style={styles.muted}>{formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)}{line.modifierSnapshots.length ? ` · ${line.modifierSnapshots.map((modifier) => modifier.optionNameAr).join("، ")}` : ""}</Text></BthwaniSurface>)}</View>      {!["CANCELLED", "DELIVERED", "PICKED_UP", "REJECTED"].includes(order.state) &&
        (order.state !== "CREATED" || order.cancellationMode !== "CLIENT_BEFORE_ACCEPTANCE") ? (
          <BthwaniSurface tone="base" style={styles.cancellationSupport}>
            <Text style={styles.title}>طلب إلغاء</Text>
            {cancellationReview?.state === "PENDING" ?
              <Text style={styles.muted}>بانتظار مراجعة العمليات · الطلب ما زال نشطًا</Text> :
             cancellationReview?.state === "APPROVED" ?
              <Text style={styles.muted}>وافقت العمليات على الإلغاء.</Text> :
              <>
                {cancellationReview?.state === "DECLINED" && cancellationReview.decisionReason ?
                  <Text style={styles.muted}>رُفض الطلب: {cancellationReview.decisionReason}</Text> : null}
                {showCancellationForm ?
                  <>
                    <TextInput accessibilityLabel="سبب طلب الإلغاء" multiline maxLength={500}
                      value={cancellationReason} onChangeText={setCancellationReason}
                      style={styles.cancellationInput} placeholder="ما سبب الإلغاء؟"
                      placeholderTextColor={theme.colorMuted} textAlign="right" />
                    <BthwaniButton label="إرسال للعمليات" busy={cancellationReviewBusy}
                      disabled={cancellationReviewBusy || cancellationReason.trim().length < 12}
                      onPress={() => void requestOperationsCancellation()} />
                    <Pressable accessibilityRole="button" onPress={() => setShowCancellationForm(false)}>
                      <Text style={styles.muted}>رجوع</Text>
                    </Pressable>
                  </> :
                  <BthwaniButton label="طلب مراجعة" variant="secondary"
                    onPress={() => setShowCancellationForm(true)} />}
              </>}
          </BthwaniSurface>
        ) : null}
      {cancelError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{cancelError}</Text> : null}
      {refreshError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{refreshError}</Text> : null}
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
      {completedState ? <>
        <BthwaniSectionHeader title="تقييم المتجر" />
        <BthwaniSurface tone="base" style={styles.ratingSurface}>
          {orderRating.kind === "loading" ? <Text style={styles.muted}>جارٍ قراءة التقييم…</Text> : null}
          {orderRating.kind === "error" ? <Text style={styles.refreshError}>تعذر عرض التقييم حاليًا.</Text> : null}
          {orderRating.kind === "ready" ? <><BthwaniStatusBadge icon="success" label="تم حفظ تقييم المتجر" tone="success" /><Text style={styles.muted}>{"★".repeat(orderRating.value.rating.rating)}{"☆".repeat(5 - orderRating.value.rating.rating)}</Text>{orderRating.value.rating.review ? <Text style={styles.reviewText}>{orderRating.value.rating.review}</Text> : null}</> : null}
          {orderRating.kind === "empty" ? <>
            <View accessibilityLabel="اختيار تقييم من نجمة إلى خمس نجوم" style={styles.ratingStars}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} نجوم`} onPress={() => setSelectedRating(value)} style={styles.ratingStar}><Text style={[styles.ratingStarText, value <= selectedRating ? styles.ratingStarSelected : null]}>{value <= selectedRating ? "★" : "☆"}</Text></Pressable>)}</View>
            <TextInput accessibilityLabel="مراجعة اختيارية" multiline maxLength={1000} onChangeText={setReview} placeholder="اكتب ملاحظتك (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.reviewInput} textAlign="right" value={review} />
            {ratingError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{ratingError}</Text> : null}
            <BthwaniButton busy={ratingSubmitting} disabled={selectedRating < 1 || ratingSubmitting} label="حفظ تقييم المتجر" onPress={() => void submitRating()} />
          </> : null}
        </BthwaniSurface>
      </> : null}
      {order.recipient.mode === "OTHER" ? <><BthwaniSectionHeader title="مستلم الطلب" />
      <BthwaniSurface tone="base" style={styles.trackingSurface}>
        <Text style={styles.proofTitle}>{order.recipient.name}</Text>
          <Text selectable style={styles.muted}>رقم التواصل: {order.recipient.phoneE164}</Text>
          {order.recipient.instructions ? <Text style={styles.muted}>تعليمات التوصيل: {order.recipient.instructions}</Text> : null}
      </BthwaniSurface></> : null}


    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const premium = premiumColors(theme);
  return StyleSheet.create({
    container: { backgroundColor: premium.background, gap: spacing[2], paddingBottom: spacing[5], width: "100%" },
    headerBar: { flexDirection: "row-reverse", alignItems: "center", minHeight: sizing.controlLg, gap: spacing[2] },
    pageTitle: { ...typography.titleLg, color: theme.color, textAlign: "center", flex: 1 },
    hero: { borderRadius: radius.lg, backgroundColor: premium.surface, borderColor: premium.stroke, borderWidth: 1, padding: spacing[2], gap: spacing[2] },
    heroStore: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[3] },
    heroImage: { height: 100, width: 100, borderRadius: radius.lg, backgroundColor: theme.surfaceRaised },
    heroImageFallback: { height: 100, width: 100, borderRadius: radius.lg, backgroundColor: theme.actionSoft, alignItems: "center", justifyContent: "center" },
    heroCopy: { flex: 1, alignItems: "flex-end", gap: spacing[1] },
    heroStoreTitle: { ...typography.titleMd, color: theme.color, textAlign: "right" },
    ratingText: { ...typography.bodyStrong, color: theme.interactiveText, textAlign: "right" },
    heroStatus: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[3], justifyContent: "flex-start" },
    heroTitle: { ...typography.titleMd, color: premium.orange, flex: 1 },
    modeTag: { padding: spacing[2], borderRadius: radius.md, backgroundColor: premium.soft, borderColor: premium.coral, borderWidth: borders.hairline },
    modeTagText: { ...typography.bodyStrong, color: premium.orange, textAlign: "right" },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    deliveryOverview: { backgroundColor: premium.surface, borderColor: premium.stroke, borderWidth: 1, padding: spacing[2], gap: spacing[2], borderRadius: radius.lg },
    courierHeading: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[3] },
    actions: { flexDirection: "row-reverse", gap: spacing[2] },
    action: { flex: 1 },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    backButton: { alignItems: "center", flexDirection: "row", gap: spacing[1], minHeight: sizing.controlMd },
    back: { ...typography.body, color: theme.interactiveText },
    summary: { alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    amountRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
    cancellationSupport: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    cancellationInput: { ...typography.body, backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 90, padding: spacing[3] },
    summaryIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    summaryCopy: { flex: 1, gap: spacing[1] },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleMd, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    status: { backgroundColor: premium.surface, borderColor: premium.stroke, borderWidth: 1, borderRadius: radius.lg, gap: spacing[2], padding: spacing[2] },
    paymentColumn: { flex: 1, gap: spacing[1] },
    journey: { gap: spacing[1], padding: spacing[2], borderRadius: radius.lg, backgroundColor: premium.surface },
    journeyHeading: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", gap: spacing[2] },
    journeyTitle: { ...typography.titleMd, color: theme.interactiveText, flex: 1, textAlign: "right" },
    journeyFulfillment: { ...typography.bodyStrong, color: theme.color, backgroundColor: theme.actionSoft, borderRadius: radius.md, padding: spacing[2], textAlign: "right" },
    journeySteps: { flexDirection: "row-reverse", justifyContent: "space-between", gap: spacing[1], paddingTop: spacing[2] },
    journeyStep: { flex: 1, alignItems: "center", gap: spacing[2] },
    journeyMarker: { width: 35, height: 35, borderRadius: 18, borderWidth: borders.hairline, borderColor: theme.borderColorStrong, backgroundColor: theme.surfaceRaised, alignItems: "center", justifyContent: "center" },
    journeyMarkerDone: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    journeyMarkerActive: { backgroundColor: theme.actionBackground },
    journeyMarkerText: { ...typography.bodyStrong, color: theme.colorMuted },
    journeyMarkerTextDone: { color: theme.color },
    journeyStepLabel: { ...typography.caption, color: theme.colorMuted, textAlign: "center" },
    journeyStepActive: { color: theme.interactiveText },
    statusCopy: { flex: 1, gap: spacing[1] },
    statusTitle: { ...typography.caption, color: theme.colorMuted },
    statusValue: { ...typography.titleSm, color: theme.interactiveText },
    statusTotal: { ...typography.bodyStrong, color: theme.color },
    payment: { ...typography.bodySm, color: theme.interactiveText },
    actionStack: { gap: spacing[2] },
    address: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], padding: spacing[2] },
    pickupLocationSurface: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    pickupLocationTitle: { ...typography.bodyStrong, color: theme.color },
    lines: { gap: spacing[2] },
    itemsShowAll: { alignSelf: "flex-start", paddingHorizontal: spacing[3], minHeight: 44, alignItems: "center", justifyContent: "center", borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.md },
    itemsAction: { ...typography.bodySm, color: theme.interactiveText },
    adjustments: { gap: spacing[3] },
    adjustment: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    adjustmentActions: { gap: spacing[2] },
    line: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2] },
    lineTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    lineTitle: { ...typography.bodyStrong, color: theme.color, flex: 1 },
    linePrice: { ...typography.bodyStrong, color: theme.interactiveText },
    refreshError: { ...typography.bodySm, color: theme.danger },
    trackingSurface: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    trackingTitle: { ...typography.bodyStrong, color: theme.interactiveText },
    proofSurface: { backgroundColor: premium.soft, borderColor: premium.coral, borderRadius: radius.xl, borderWidth: 1, gap: spacing[3], padding: spacing[4] },
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
