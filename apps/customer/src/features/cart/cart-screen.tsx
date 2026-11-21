import { DshCartError, type CustomerCartChange } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Crypto from "expo-crypto";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { readVerifiedCart, replaceVerifiedCart, type CartReadState } from "./cart-transport";

const formatYER = new Intl.NumberFormat("ar-YE");
type Pending = { actorId: string; change: CustomerCartChange };

export default function CartScreen() {
  const { theme } = useMobileAppearance();
  const { storeId: storeParam } = useLocalSearchParams<{ storeId?: string }>();
  const storeId = typeof storeParam === "string" ? storeParam : "";
  const [view, setView] = useState<CartReadState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useRef<(() => void) | null>(null);
  const pending = useRef<Pending | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useFocusEffect(useCallback(() => {
    const epoch = ++generation.current;
    const controller = new AbortController();
    pending.current = null;
    setView(null);
    setError("");
    setBusy(false);
    function load() {
      if (controller.signal.aborted || mutation.current) return;
      setView(null);
      setError("");
      void readVerifiedCart(storeId, controller.signal).then(next => {
        if (!controller.signal.aborted && generation.current === epoch) setView(next);
      }).catch(() => {
        if (!controller.signal.aborted && generation.current === epoch) setView({ kind: "unavailable" });
      });
    }
    refresh.current = load;
    load();
    return () => {
      controller.abort();
      mutation.current?.abort();
      mutation.current = null;
      refresh.current = null;
      generation.current++;
      setView(null);
    };
  }, [storeId]));

  async function apply(change: CustomerCartChange, actorId: string) {
    if (mutation.current) return;
    const controller = new AbortController();
    const epoch = generation.current;
    mutation.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await replaceVerifiedCart(storeId, change, actorId, controller.signal);
      if (controller.signal.aborted || generation.current !== epoch) return;
      pending.current = null;
      setView({ kind: "ready", cart: result.cart });
    } catch (reason) {
      if (controller.signal.aborted || generation.current !== epoch) return;
      const code = reason instanceof DshCartError ? reason.code : "OPERATION_RESULT_UNKNOWN";
      if (code === "OPERATION_RESULT_UNKNOWN") {
        setError("لم تتأكد نتيجة التعديل. أعد تأكيد نفس العملية قبل إجراء تعديل جديد.");
      } else {
        pending.current = null;
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
    if (view?.kind !== "ready" || pending.current || busy) return;
    const cart = view.cart;
    const lines = cart.lines.filter(item => item.offerId !== offerId)
      .map(item => ({ offerId: item.offerId, quantity: item.quantity }));
    if (quantity > 0) lines.push({ offerId, quantity });
    const change: CustomerCartChange = {
      operationId: `cart-${Crypto.randomUUID()}`,
      expectedVersion: cart.version,
      lines,
    };
    pending.current = { actorId: cart.actorId, change };
    void apply(change, cart.actorId);
  }

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
                  {formatYER.format(BigInt(line.previewUnitYer))} ريال يمني للوحدة — معاينة فقط
                </Text>
                {!line.previewAvailable ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>
                  المنتج غير متاح الآن، ولا يمكن تأكيد الطلب.
                </Text> : null}
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Pressable accessibilityRole="button" accessibilityLabel="تقليل الكمية"
                    disabled={busy || !!pending.current}
                    onPress={() => changeQuantity(line.offerId, line.quantity - 1)} style={buttonStyle}>
                    <Text style={{ color: theme.interactiveText }}>−</Text>
                  </Pressable>
                  <Text style={{ color: theme.color }}>{line.quantity}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="زيادة الكمية"
                    disabled={busy || !!pending.current || line.quantity >= 2147483647}
                    onPress={() => changeQuantity(line.offerId, line.quantity + 1)} style={buttonStyle}>
                    <Text style={{ color: theme.interactiveText }}>+</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={busy || !!pending.current}
                    onPress={() => changeQuantity(line.offerId, 0)} style={buttonStyle}>
                    <Text style={{ color: theme.interactiveText }}>إزالة</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
            {view?.kind === "signed-out" ? "يجب تسجيل الدخول بحساب العميل لعرض السلة."
              : view?.kind === "unavailable" ? "تعذر التحقق من السلة لدى DSH."
                : "جارٍ التحقق من السلة."}
          </Text>
        )}
        {error ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>{error}</Text> : null}
        {pending.current ? (
          <Pressable disabled={busy} accessibilityRole="button" style={buttonStyle} onPress={() => {
            const next = pending.current;
            if (next) void apply(next.change, next.actorId);
          }}>
            <Text style={{ color: theme.interactiveText }}>
              {busy ? "جارٍ التأكيد" : "التحقق من نتيجة آخر تعديل"}
            </Text>
          </Pressable>
        ) : null}
        {!pending.current && view?.kind !== "signed-out" ? (
          <Pressable accessibilityRole="button" disabled={busy} style={buttonStyle}
            onPress={() => refresh.current?.()}>
            <Text style={{ color: theme.interactiveText }}>تحديث السلة</Text>
          </Pressable>
        ) : null}
        {view?.kind === "signed-out" ? <Link href="/account" style={{ color: theme.interactiveText }}>
          الانتقال إلى الحساب
        </Link> : null}
        <Link href="/stores" style={{ color: theme.interactiveText }}>متابعة تصفح المتاجر</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
