import { type CustomerCartChange, type CustomerCartMerchandiseEstimate, DshCartError } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Crypto from "expo-crypto";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatExactYer } from "../../components/format-exact-yer";
import { previewLineSubtotalYer, summarizeCartPreview } from "./cart-preview";
import { pendingCartChange } from "./cart-session";
import { type CartReadState, readVerifiedCart, readVerifiedCartMerchandiseEstimate, replaceVerifiedCart } from "./cart-transport";

export default function CartScreen() {
  const { theme } = useMobileAppearance();
  const { storeId: storeParam } = useLocalSearchParams<{ storeId?: string }>();
  const storeId = typeof storeParam === "string" ? storeParam : "";
  const [snapshot, setView] = useState<CartReadState | null>(null);
  const [error, setError] = useState("");
  const [ownerMerchandise, setOwnerMerchandise] = useState<CustomerCartMerchandiseEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useRef<(() => void) | null>(null);
  const cartRead = useRef<AbortController | null>(null);
  const estimateRead = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const view = snapshot?.kind === "ready" && snapshot.cart.storeId !== storeId ? null : snapshot;
  const pending = view?.kind === "ready" ? pendingCartChange(view.cart.actorId, storeId) : undefined;

  useEffect(() => {
    const reload = () => refresh.current?.();
    if (Platform.OS === "web") {
      window.addEventListener("focus", reload);
      return () => window.removeEventListener("focus", reload);
    }
    const listener = AppState.addEventListener("change", status => {
      if (status === "active") reload();
    });
    return () => listener.remove();
  }, []);

  useFocusEffect(useCallback(() => {
    const epoch = ++generation.current;
    setView(null);
    setError("");
    setBusy(false);
    function load() {
      if (generation.current !== epoch || mutation.current) return;
      cartRead.current?.abort();
      estimateRead.current?.abort();
      const controller = new AbortController();
      cartRead.current = controller;
      setView(null);
      setOwnerMerchandise(null);
      setError("");
      void readVerifiedCart(storeId, controller.signal).then(next => {
        if (!controller.signal.aborted && generation.current === epoch) setView(next);
      }).catch(() => {
        if (!controller.signal.aborted && generation.current === epoch) setView({ kind: "unavailable" });
      }).finally(() => {
        if (cartRead.current === controller) cartRead.current = null;
      });
    }
    refresh.current = load;
    load();
    return () => {
      cartRead.current?.abort();
      cartRead.current = null;
      estimateRead.current?.abort();
      estimateRead.current = null;
      mutation.current?.abort();
      mutation.current = null;
      refresh.current = null;
      generation.current++;
      setView(null);
    };
  }, [storeId]));

  useEffect(() => {
    if (view?.kind !== "ready" || view.cart.lines.length === 0) {
      setOwnerMerchandise(null);
      return;
    }
    const controller = new AbortController();
    estimateRead.current = controller;
    const actor = view.cart.actorId;
    const version = view.cart.version;
    setOwnerMerchandise(null);
    void readVerifiedCartMerchandiseEstimate(storeId, version, actor, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        if (result.kind === "signed-out") {
          setOwnerMerchandise(null);
          setView({ kind: "signed-out" });
        } else if (result.kind === "ready" && result.estimate.storeId === storeId &&
          result.estimate.actorId === actor && result.estimate.cartVersion === version) {
          setOwnerMerchandise(result.estimate);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setOwnerMerchandise(null);
      });
    return () => {
      controller.abort();
      if (estimateRead.current === controller) estimateRead.current = null;
    };
  }, [storeId, view]);

  async function apply(change: CustomerCartChange, actorId: string) {
    if (mutation.current || cartRead.current) return;
    estimateRead.current?.abort();
    const controller = new AbortController();
    const epoch = generation.current;
    mutation.current = controller;
    setBusy(true);
    setOwnerMerchandise(null);
    setError("");
    try {
      const result = await replaceVerifiedCart(storeId, change, actorId, controller.signal);
      if (controller.signal.aborted || generation.current !== epoch) return;
      setView({ kind: "ready", cart: result.cart });
    } catch (reason) {
      if (controller.signal.aborted || generation.current !== epoch) return;
      const code = reason instanceof DshCartError ? reason.code : "OPERATION_RESULT_UNKNOWN";
      if (code === "OPERATION_RESULT_UNKNOWN" || code === "CART_PENDING_RECONCILIATION") {
        setError("لم تتأكد نتيجة التعديل. أعد تأكيد نفس العملية قبل إجراء تعديل جديد.");
      } else {
        if (code === "UNAUTHORIZED") setView({ kind: "signed-out" });
        setError(code === "CART_VERSION_OR_OPERATION_CONFLICT"
          ? "تغيّرت السلة. حدّث البيانات قبل إعادة التعديل."
          : code === "STORE_OR_OFFER_NOT_AVAILABLE"
            ? "المتجر أو المنتج لم يعد متاحًا بهذه الكمية. حدّث السلة."
            : code === "UNAUTHORIZED" ? "انتهت جلسة العميل. أعد تسجيل الدخول."
              : "تعذّر تحديث السلة.");
      }
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        setBusy(false);
      }
    }
  }

  function changeQuantity(offerId: string, quantity: number) {
    if (view?.kind !== "ready" || pendingCartChange(view.cart.actorId, storeId) || busy) return;
    const cart = view.cart;
    const lines = cart.lines.filter(item => item.offerId !== offerId)
      .map(item => ({ offerId: item.offerId, quantity: item.quantity }));
    if (quantity > 0) lines.push({ offerId, quantity });
    const change: CustomerCartChange = {
      operationId: `cart-${Crypto.randomUUID()}`,
      expectedVersion: cart.version,
      lines,
    };
    void apply(change, cart.actorId);
  }

  const preview = view?.kind === "ready" ? summarizeCartPreview(view.cart.lines) : null;
  const buttonStyle = {
    borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10,
    minHeight: 44, paddingHorizontal: 14, justifyContent: "center" as const,
    alignItems: "center" as const,
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ gap: 16, padding: 20, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 25, fontWeight: "700" }}>سلة المتجر</Text>
        <Text style={{ color: theme.colorSecondary }}>
          هذه سلة مسودة لدى بثواني. الأسعار والمخزون للمعاينة فقط؛ تأكيد الطلب والدفع غير متاحين بعد.
        </Text>
        {view?.kind === "ready" ? (
          <View style={{ gap: 12 }}>
            {view.cart.lines.length === 0 ? (
              <Text style={{ color: theme.colorSecondary }}>سلتك فارغة. أضف منتجًا من صفحة المتجر.</Text>
            ) : view.cart.lines.map(line => (
              <View key={line.offerId} style={{
                borderWidth: 1, borderColor: theme.borderColor, backgroundColor: theme.surface,
                borderRadius: 12, padding: 14, gap: 9,
              }}>
                <Text style={{ color: theme.color, fontWeight: "700" }}>{line.name}</Text>
                <Text style={{ color: theme.colorSecondary }}>
                  {formatExactYer(BigInt(line.previewUnitYer))} ريال يمني للوحدة — معاينة فقط
                </Text>
                <Text style={{ color: theme.colorSecondary }}>
                  مجموع الصنف التقديري: {formatExactYer(previewLineSubtotalYer(line))} ريال يمني
                </Text>
                {!line.previewAvailable ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>
                  المنتج غير متاح الآن، ولا يمكن تأكيد الطلب.
                </Text> : null}
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Pressable accessibilityRole="button" accessibilityLabel="تقليل الكمية"
                    disabled={busy || !!pending}
                    onPress={() => changeQuantity(line.offerId, line.quantity - 1)} style={buttonStyle}>
                    <Text style={{ color: theme.interactiveText }}>−</Text>
                  </Pressable>
                  <Text style={{ color: theme.color }}>{line.quantity}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="زيادة الكمية"
                    disabled={busy || !!pending || line.quantity >= 2147483647}
                    onPress={() => changeQuantity(line.offerId, line.quantity + 1)} style={buttonStyle}>
                    <Text style={{ color: theme.interactiveText }}>+</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={busy || !!pending}
                    onPress={() => changeQuantity(line.offerId, 0)} style={buttonStyle}>
                    <Text style={{ color: theme.interactiveText }}>إزالة</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {preview ? (
              <View testID="cart-preview-summary" style={{
                padding: 14, borderWidth: 1, borderColor: theme.borderColor,
                borderRadius: 12, backgroundColor: theme.surface, gap: 8,
              }}>
                <Text style={{ color: theme.color, fontWeight: "700" }}>
                  الإجمالي التقديري للعروض المتاحة: {formatExactYer(preview.availableSubtotalYer)} ريال يمني
                </Text>
                {preview.unavailableLines > 0 ? (
                  <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>
                    عروض غير متاحة: {preview.unavailableLines}. لم تدخل في الإجمالي التقديري.
                  </Text>
                ) : null}
                {ownerMerchandise && ownerMerchandise.cartVersion === view.cart.version &&
                  ownerMerchandise.storeId === storeId && ownerMerchandise.actorId === view.cart.actorId && !busy && !pending ? (
                    <Text testID="cart-dsh-merchandise-estimate" style={{ color: theme.color }}>
                      مجموع البضائع المحسوب لدى DSH لهذه النسخة: {formatExactYer(BigInt(ownerMerchandise.merchandiseSubtotalYer))} ريال يمني.
                    </Text>
                  ) : (
                    <Text style={{ color: theme.colorSecondary }}>
                      لا يوجد تقدير بضائع حديث ومتحقق من DSH لهذه النسخة.
                    </Text>
                  )}
                <Text style={{ color: theme.colorSecondary }}>
                  هذه القيمة للبضائع فقط؛ لا تشمل التوصيل والرسوم ولا تُعد عرض دفع أو تأكيد طلب.
                  يتحقق DSH وWLT من الإجمالي النهائي عند تفعيل رحلة الطلب.
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
            {view?.kind === "signed-out" ? "يجب تسجيل الدخول بحساب العميل لعرض السلة."
              : view?.kind === "unavailable" ? "تعذر التحقق من السلة لدى DSH."
                : "جارٍ التحقق من السلة."}
          </Text>
        )}
        {error ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>{error}</Text> : null}
        {view?.kind === "ready" && pending ? (
          <Pressable disabled={busy} accessibilityRole="button" style={buttonStyle}
            onPress={() => void apply(pending, view.cart.actorId)}>
            <Text style={{ color: theme.interactiveText }}>
              {busy ? "جارٍ التأكيد" : "التحقق من نتيجة آخر تعديل"}
            </Text>
          </Pressable>
        ) : null}
        {!pending && (view?.kind === "unavailable" || !!error) ? (
          <Pressable accessibilityRole="button" disabled={busy} style={buttonStyle}
            onPress={() => refresh.current?.()}>
            <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
          </Pressable>
        ) : null}
        {view?.kind === "signed-out" ? <Link href="/account" style={{ color: theme.interactiveText }}>
          الانتقال إلى الحساب
        </Link> : null}
        {view?.kind === "ready" && view.cart.lines.length > 0 &&
          !busy && !pending && !error ? (
            <Link href={{ pathname: "/checkout", params: { storeId } }}
              style={{ color: theme.interactiveText }}>
              مراجعة السلة قبل الطلب
            </Link>
          ) : null}
        <Link href="/stores" style={{ color: theme.interactiveText }}>متابعة تصفح المتاجر</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
