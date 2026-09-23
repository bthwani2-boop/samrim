import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSectionHeader, BthwaniSkeleton, BthwaniStatusBadge, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, type DeliveryProofResponse, formatMoney, formatOrderDate, formatQuantity, type Order, type OrderRatingResponse, type OrderTrackingResponse, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { OrderConversation } from "./order-conversation";

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

export default function ClientOrderDetail() {
  const { orderId: rawOrderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = Array.isArray(rawOrderId) ? rawOrderId[0] ?? "" : rawOrderId ?? "";
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; order: Order } | { kind: "error" } | { kind: "auth_required" }>({ kind: "loading" });
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [tracking, setTracking] = useState<{ kind: "loading" } | { kind: "ready"; value: OrderTrackingResponse } | { kind: "error" }>({ kind: "loading" });
  const [deliveryProof, setDeliveryProof] = useState<{ kind: "loading" } | { kind: "ready"; value: DeliveryProofResponse } | { kind: "error" }>({ kind: "loading" });
  const [orderRating, setOrderRating] = useState<{ kind: "hidden" | "loading" } | { kind: "ready"; value: OrderRatingResponse } | { kind: "empty" } | { kind: "error" }>({ kind: "hidden" });
  const [selectedRating, setSelectedRating] = useState(0);
  const [review, setReview] = useState("");
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState("");

  const refreshTracking = useCallback(async () => {
    if (!orderId.trim()) return;
    try {
      const token = await getUsableIdentityAccessToken();
      setTracking({ kind: "ready", value: await client().readClientOrderTracking(token, orderId) });
    } catch (error) {
      console.error("DSH client order tracking read failed", error);
      setTracking({ kind: "error" });
    }
  }, [orderId]);

  const refreshDeliveryProof = useCallback(async () => {
    if (!orderId.trim()) return;
    try {
      const token = await getUsableIdentityAccessToken();
      setDeliveryProof({ kind: "ready", value: await client().readClientDeliveryProof(token, orderId) });
    } catch (error) {
      console.error("DSH client delivery proof read failed", error);
      setDeliveryProof({ kind: "error" });
    }
  }, [orderId]);

  const refreshRating = useCallback(async (orderState: Order["state"]) => {
    if (!orderId.trim() || (orderState !== "DELIVERED" && orderState !== "PICKED_UP")) {
      setOrderRating({ kind: "hidden" });
      return;
    }
    setOrderRating({ kind: "loading" });
    setRatingError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const value = await client().readClientOrderRating(token, orderId);
      setSelectedRating(value.rating.rating);
      setReview(value.rating.review);
      setOrderRating({ kind: "ready", value });
    } catch (error) {
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
    if (!orderId.trim()) { setState({ kind: "error" }); return; }
    if (preserveCurrent) setRefreshing(true);
    else setState({ kind: "loading" });
    setRefreshError("");
    setCancelError("");
    setTracking({ kind: "loading" });
    setDeliveryProof({ kind: "loading" });
    setOrderRating({ kind: "loading" });
    try {
      const token = await getUsableIdentityAccessToken();
      const order = (await client().readOrder(token, orderId)).order;
      setState({ kind: "ready", order });
      await refreshDeliveryProof();
      if (order.fulfillmentMode === "BTHWANI_CAPTAIN") await refreshTracking();
      await refreshRating(order.state);
    } catch (error) {
      console.error("DSH client order detail read failed", error);
      if (preserveCurrent) setRefreshError("تعذر تحديث الحالة. ما زالت التفاصيل الحالية معروضة.");
      else setState({ kind: "error" });
    } finally {
      setRefreshing(false);
    }
  }, [orderId, refreshDeliveryProof, refreshRating, refreshTracking]);

  const submitRating = useCallback(async () => {
    if (state.kind !== "ready" || (state.order.state !== "DELIVERED" && state.order.state !== "PICKED_UP") || selectedRating < 1 || ratingSubmitting) return;
    setRatingSubmitting(true);
    setRatingError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const value = await client().createClientOrderRating(token, state.order.id, { rating: selectedRating, review }, state.order.version);
      setOrderRating({ kind: "ready", value });
      setReview(value.rating.review);
    } catch (error) {
      console.error("DSH client order rating create failed", error);
      setRatingError("تعذر حفظ التقييم. قد تكون العملية سُجلت بالفعل؛ حدّث الحالة للتحقق.");
    } finally {
      setRatingSubmitting(false);
    }
  }, [ratingSubmitting, review, selectedRating, state]);

  const cancelOrder = useCallback(async () => {
    if (state.kind !== "ready" || state.order.state !== "CREATED" || cancelling) return;
    setCancelling(true);
    setCancelError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().cancelClientOrder(token, state.order.id, state.order.version);
      setState({ kind: "ready", order: result.order });
      await refreshTracking();
    } catch (error) {
      console.error("DSH client order cancellation failed", error);
      setCancelError("تعذر إلغاء الطلب. ربما بدأ المتجر معالجته؛ حدّث الحالة وحاول مرة أخرى.");
    } finally {
      setCancelling(false);
    }
  }, [cancelling, refreshTracking, state]);

  function requestCancel() {
    Alert.alert("إلغاء الطلب", "سيتم إلغاء الطلب وإلغاء التحصيل النقدي. هل تريد المتابعة؟", [
      { text: "متابعة الطلب", style: "cancel" },
      { text: "إلغاء الطلب", style: "destructive", onPress: () => void cancelOrder() },
    ]);
  }

  useEffect(() => subscribeIdentitySession(setIdentityState), []);

  useEffect(() => {
    if (identityState.kind !== "authenticated") {
      setState({ kind: "auth_required" });
      setRefreshError("");
      return;
    }
    void load();
  }, [identityState.kind, load]);

  useEffect(() => {
    if (state.kind !== "ready" || state.order.fulfillmentMode === "CUSTOMER_PICKUP" || ["DELIVERED", "DELIVERY_FAILED", "CANCELLED", "PICKED_UP"].includes(state.order.state)) return;
    const timer = setInterval(() => { void refreshTracking(); }, 30_000);
    return () => clearInterval(timer);
  }, [refreshTracking, state]);

  if (state.kind === "auth_required") return <View style={styles.state}><BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>سجّل الدخول لعرض تفاصيل الطلب</Text><Text style={styles.muted}>سجّل الدخول أولًا ثم افتح الطلب مرة أخرى.</Text><BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/orders" as Href)} /></View>;
  if (state.kind === "loading") return <View style={styles.state} accessibilityLabel="جارٍ تجهيز تفاصيل الطلب"><BthwaniSkeleton width="42%" height={28} /><BthwaniSkeleton height={128} /><BthwaniSkeleton height={180} /></View>;
  if (state.kind === "error") return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر قراءة تفاصيل الطلب</Text><Text style={styles.muted}>قد تكون الجلسة أو الطلب غير متاحين الآن.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /><BthwaniButton label="العودة إلى الطلبات" onPress={() => router.back()} variant="secondary" /></View>;

  const { order } = state;
  const isStorePickup = order.fulfillmentMode === "CUSTOMER_PICKUP";
  const proofLabel = isStorePickup ? "رمز الاستلام" : "رمز التسليم";
  const completedState = order.state === "DELIVERED" || order.state === "PICKED_UP";
  return (
    <View style={styles.container} accessibilityLabel="تفاصيل الطلب">
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى الطلبات" onPress={() => router.back()} style={styles.backButton}><BthwaniIcon name="back" color={theme.interactiveText} size={sizing.iconMd} /><Text style={styles.back}>طلباتي</Text></Pressable>
      <BthwaniSurface tone="raised" style={styles.summary}>
        <View style={styles.summaryIcon}><BthwaniIcon name="orders" color={theme.onAction} size={sizing.iconXl} /></View>
        <View style={styles.summaryCopy}><Text style={styles.eyebrow}>طلبك</Text><Text style={styles.title}>طلب {formatOrderDate(order.createdAt)}</Text><Text style={styles.muted}>{isStorePickup ? `الاستلام من ${order.storeName}` : order.addressText}</Text></View>
      </BthwaniSurface>
      <View style={styles.status}><View style={styles.statusCopy}><Text style={styles.statusTitle}>الحالة الحالية</Text><BthwaniStatusBadge icon={order.state === "DELIVERED" ? "success" : order.state === "DELIVERY_FAILED" ? "warning" : order.state === "CANCELLED" ? "warning" : "orders"} label={orderStateLabel(order.state)} tone={order.state === "DELIVERED" ? "success" : order.state === "DELIVERY_FAILED" || order.state === "CANCELLED" ? "danger" : "info"} /><Text style={styles.statusTotal}>{formatMoney(order.totalAmountMinor, order.currency)}</Text><Text style={styles.payment}>{paymentMethodLabel(order.paymentMethod)} · {paymentStateLabel(order.paymentState, order.paymentMethod)}</Text></View><View style={styles.actionStack}><BthwaniButton accessibilityLabel="تحديث حالة الطلب" busy={refreshing} label="تحديث الحالة" onPress={() => void load(true)} variant="secondary" />{order.state === "CREATED" ? <BthwaniButton accessibilityLabel="إلغاء الطلب" busy={cancelling} disabled={cancelling || refreshing} label="إلغاء الطلب" onPress={requestCancel} variant="danger" /> : null}</View></View>
      {refreshError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{refreshError}</Text> : null}
      {cancelError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{cancelError}</Text> : null}
      <OrderConversation orderId={order.id} />
      <BthwaniSectionHeader title={isStorePickup ? "رمز الاستلام من المتجر" : "إثبات التسليم"} subtitle={isStorePickup ? "أظهر الرمز لموظف المتجر عند استلام الطلب" : "يؤكّد العميل الرمز للكابتن عند استلام الطلب"} />
      <BthwaniSurface tone="base" style={styles.proofSurface}>
        {deliveryProof.kind === "loading" ? <Text style={styles.muted}>جارٍ تجهيز {proofLabel}…</Text> : null}
        {deliveryProof.kind === "error" ? <Text style={styles.refreshError}>تعذر قراءة {proofLabel} الآن. حدّث الحالة لإعادة المحاولة.</Text> : null}
        {deliveryProof.kind === "ready" && deliveryProof.value.state === "PENDING" ? <><Text style={styles.proofTitle}>{proofLabel}</Text><Text accessibilityLabel={proofLabel} style={styles.proofCode}>{deliveryProof.value.code ?? "—"}</Text><Text style={styles.muted}>{isStorePickup ? "أظهر الرمز لموظف المتجر بعد تجهيز طلبك." : "لا تشارك الرمز إلا مع الكابتن عند وصول الطلب."}</Text></> : null}
        {deliveryProof.kind === "ready" && deliveryProof.value.state === "VERIFIED" ? <><BthwaniStatusBadge icon="success" label={isStorePickup ? "تم تأكيد الاستلام" : "تم إثبات التسليم"} tone="success" /><Text style={styles.muted}>{isStorePickup ? "تم قبول رمز الاستلام وتسجيل استلامك للطلب." : "تم قبول رمز التسليم وتسجيل الاستلام."}</Text></> : null}
      </BthwaniSurface>
      {completedState ? <>
        <BthwaniSectionHeader title="قيّم تجربتك" subtitle={isStorePickup ? "رأيك يساعدنا على تحسين تجربة الاستلام من المتجر" : "رأيك يساعدنا على تحسين جودة التوصيل"} />
        <BthwaniSurface tone="base" style={styles.ratingSurface}>
          {orderRating.kind === "loading" ? <Text style={styles.muted}>جارٍ قراءة التقييم…</Text> : null}
          {orderRating.kind === "error" ? <Text style={styles.refreshError}>تعذر قراءة التقييم الآن. حدّث الحالة لإعادة المحاولة.</Text> : null}
          {orderRating.kind === "ready" ? <><BthwaniStatusBadge icon="success" label="تم حفظ تقييمك" tone="success" /><Text style={styles.muted}>{"★".repeat(orderRating.value.rating.rating)}{"☆".repeat(5 - orderRating.value.rating.rating)}</Text>{orderRating.value.rating.review ? <Text style={styles.reviewText}>{orderRating.value.rating.review}</Text> : null}</> : null}
          {orderRating.kind === "empty" ? <>
            <Text style={styles.muted}>اختر من نجمة إلى خمس نجوم، ويمكنك إضافة ملاحظة قصيرة.</Text>
            <View accessibilityLabel="اختيار تقييم من نجمة إلى خمس نجوم" style={styles.ratingStars}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} نجوم`} onPress={() => setSelectedRating(value)} style={styles.ratingStar}><Text style={[styles.ratingStarText, value <= selectedRating ? styles.ratingStarSelected : null]}>{value <= selectedRating ? "★" : "☆"}</Text></Pressable>)}</View>
            <TextInput accessibilityLabel="مراجعة اختيارية" multiline maxLength={1000} onChangeText={setReview} placeholder="اكتب ملاحظتك (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.reviewInput} textAlign="right" value={review} />
            {ratingError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{ratingError}</Text> : null}
            <BthwaniButton busy={ratingSubmitting} disabled={selectedRating < 1 || ratingSubmitting} label="حفظ التقييم" onPress={() => void submitRating()} />
          </> : null}
        </BthwaniSurface>
      </> : null}
      {!isStorePickup ? <>
      <BthwaniSectionHeader title="التتبع المباشر" subtitle="يظهر الموقع أثناء عهدة الكابتن فقط" />
      <BthwaniSurface tone="base" style={styles.trackingSurface}>
        {tracking.kind === "loading" ? <Text style={styles.muted}>جارٍ قراءة حالة التتبع…</Text> : null}
        {tracking.kind === "error" ? <Text style={styles.refreshError}>تعذر قراءة التتبع الآن. حدّث الحالة لإعادة المحاولة.</Text> : null}
        {tracking.kind === "ready" && tracking.value.trackingState === "NOT_ASSIGNED" ? <Text style={styles.muted}>سيظهر التتبع بعد إسناد الطلب إلى كابتن.</Text> : null}
        {tracking.kind === "ready" && tracking.value.trackingState === "AWAITING_LOCATION" ? <Text style={styles.muted}>تم إسناد الطلب، وبانتظار أول تحديث موقع من الكابتن.</Text> : null}
        {tracking.kind === "ready" && tracking.value.trackingState === "COMPLETED" ? <Text style={styles.muted}>{order.state === "DELIVERY_FAILED" ? "تعذرت محاولة التوصيل، فأوقفنا التتبع المباشر إلى أن يعالج المشغل الحالة." : order.state === "CANCELLED" ? "أُلغي الطلب، لذلك أوقفنا التتبع المباشر." : "اكتملت رحلة التوصيل، وتم إيقاف عرض الموقع."}</Text> : null}
        {tracking.kind === "ready" && tracking.value.trackingState === "LIVE" && tracking.value.captainLocation ? <><Text style={styles.trackingTitle}>الكابتن في الطريق</Text><Text style={styles.muted}>آخر تحديث: {formatTrackingTime(tracking.value.captainLocation.updatedAt)}</Text><BthwaniButton label="فتح الموقع على الخريطة" onPress={() => void Linking.openURL(`geo:${tracking.value.captainLocation?.latitude},${tracking.value.captainLocation?.longitude}?q=${tracking.value.captainLocation?.latitude},${tracking.value.captainLocation?.longitude}`)} variant="secondary" /></> : null}
      </BthwaniSurface>
      </> : null}
      {isStorePickup ? <>
        <BthwaniSectionHeader title="موقع الاستلام" />
        <BthwaniSurface tone="base" style={styles.pickupLocationSurface}>
          <Text style={styles.pickupLocationTitle}>{order.storeName}</Text>
          {order.pickupLocation ? <>
            <Text style={styles.muted}>هذا هو موقع الفرع الحالي للاستلام.</Text>
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

function formatTrackingTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير معروف";
  return new Intl.DateTimeFormat("ar-YE", { dateStyle: "short", timeStyle: "short" }).format(date);
}
