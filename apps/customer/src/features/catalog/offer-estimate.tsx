import { type CustomerCartChange, DshCartError, DshPublicError, estimatePublicOffer, type PublicOffer, type PublicOfferEstimate, parseOfferEstimateQuantity } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Crypto from "expo-crypto";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { pendingCartChange } from "../cart/cart-session";
import { readVerifiedCart, replaceVerifiedCart } from "../cart/cart-transport";
import { resolvePublicStoreOrigin } from "../stores/public-store-origin";
import { formatPublicEstimateYer } from "./price-format";

export default function OfferEstimate({ offer }: Readonly<{ offer: PublicOffer }>) {
  const { theme } = useMobileAppearance();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [estimate, setEstimate] = useState<PublicOfferEstimate>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cartMessage, setCartMessage] = useState("");
  const [savingCart, setSavingCart] = useState(false);
  const [recoveryActor, setRecoveryActor] = useState<string | null>(null);
  const cartRequest = useRef<AbortController | null>(null);
  const pending = useRef<AbortController | null>(null);
  useFocusEffect(useCallback(() => () => {
    pending.current?.abort();
    pending.current = null;
    cartRequest.current?.abort();
    cartRequest.current = null;
    setRecoveryActor(null);
    setCartMessage("");
    setSavingCart(false);
    setEstimate(undefined);
    setError("");
    setBusy(false);
  }, []));

  function clearResult() {
    pending.current?.abort();
    pending.current = null;
    setEstimate(undefined);
    setError("");
    setBusy(false);
  }

  async function load() {
    clearResult();
    const parsed = parseOfferEstimateQuantity(quantity);
    if (parsed === null) {
      setError("أدخل كمية صحيحة أكبر من صفر.");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const value = await estimatePublicOffer(resolvePublicStoreOrigin(), offer.storeId, offer.id, parsed,
        AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
      if (controller.signal.aborted) return;
      if (value.variantId !== offer.variantId) setError("تغيّر الصنف. حدّث عروض المتجر ثم حاول مجددًا.");
      else setEstimate(value);
    } catch (reason) {
      if (!controller.signal.aborted) {
        const code = reason instanceof DshPublicError ? reason.code : undefined;
        setError(code === "INSUFFICIENT_AVAILABLE_QUANTITY" ? "الكمية المطلوبة غير متاحة. جرّب كمية أقل."
          : code === "NOT_FOUND" ? "هذا العرض غير متاح الآن." : "تعذّر التحقق من السعر. حاول مجددًا.");
      }
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  async function addDraftToCart() {
    if ((!estimate && !recoveryActor) || savingCart || cartRequest.current) return;
    const requested = parseOfferEstimateQuantity(quantity);
    if (!recoveryActor && requested === null) {
      setCartMessage("الكمية غير صحيحة.");
      return;
    }
    const controller = new AbortController();
    cartRequest.current = controller;
    setSavingCart(true);
    setCartMessage("");
    let actorId: string | undefined;
    try {
      const current = await readVerifiedCart(offer.storeId, controller.signal);
      if (controller.signal.aborted) return;
      if (current.kind !== "ready") {
        setRecoveryActor(null);
        setCartMessage(current.kind === "signed-out"
          ? "سجّل الدخول بحساب العميل لإضافة المنتجات." : "السلة غير متاحة الآن.");
        return;
      }
      actorId = current.cart.actorId;
      let change = pendingCartChange(actorId, offer.storeId);
      if (change && recoveryActor !== actorId) {
        setRecoveryActor(actorId);
        setCartMessage("توجد نتيجة غير مؤكدة على سلة هذا المتجر. تحقّق منها أولًا.");
        return;
      }
      if (!change) {
        if (recoveryActor || requested === null) {
          setRecoveryActor(null);
          setCartMessage("حدّثت السلة. راجع الكمية قبل إرسال إضافة جديدة.");
          return;
        }
        const currentQuantity = current.cart.lines.find(item => item.offerId === offer.id)?.quantity ?? 0;
        const nextQuantity = currentQuantity + requested;
        if (!Number.isSafeInteger(nextQuantity) || nextQuantity > 2147483647) {
          setCartMessage("وصلت الكمية إلى الحد المسموح.");
          return;
        }
        const lines = current.cart.lines.filter(item => item.offerId !== offer.id)
          .map(item => ({ offerId: item.offerId, quantity: item.quantity }));
        lines.push({ offerId: offer.id, quantity: nextQuantity });
        if (lines.length > 20) {
          setCartMessage("لا يمكن إضافة أكثر من 20 منتجًا إلى مسودة السلة.");
          return;
        }
        const addition: CustomerCartChange = {
          operationId: `cart-${Crypto.randomUUID()}`,
          expectedVersion: current.cart.version,
          lines,
        };
        change = addition;
      }
      const next = await replaceVerifiedCart(offer.storeId, change, actorId, controller.signal);
      if (controller.signal.aborted) return;
      setRecoveryActor(null);
      setCartMessage(recoveryActor || next.replay ? "تم تأكيد آخر تعديل على مسودة السلة."
        : "أضيف المنتج إلى مسودة السلة.");
    } catch (reason) {
      if (controller.signal.aborted) return;
      const code = reason instanceof DshCartError ? reason.code : undefined;
      const unresolved = actorId && code !== "UNAUTHORIZED" && pendingCartChange(actorId, offer.storeId);
      setRecoveryActor(unresolved ? actorId ?? null : null);
      setCartMessage(unresolved
        ? "لم تتأكد النتيجة. تحقّق من العملية نفسها قبل إرسال تعديل آخر."
        : code === "CART_VERSION_OR_OPERATION_CONFLICT"
          ? "تغيّرت السلة. افتحها وحدّث بياناتها قبل الإضافة."
          : code === "STORE_OR_OFFER_NOT_AVAILABLE"
            ? "لم يعد المنتج متاحًا بهذه الكمية."
            : "تعذرت إضافة المنتج إلى السلة.");
    } finally {
      if (cartRequest.current === controller) {
        cartRequest.current = null;
        setSavingCart(false);
      }
    }
  }

  const control = { minHeight: 44, padding: 10, justifyContent: "center", borderWidth: 1,
    borderColor: theme.borderColor, borderRadius: 10 } as const;
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
      onPress={() => { clearResult(); setOpen(!open); }} style={control}>
      <Text style={{ color: theme.interactiveText }}>{open ? "إخفاء تقدير السعر" : "تقدير سعر الكمية"}</Text>
    </Pressable>
    {open ? <>
      <TextInput value={quantity} accessibilityLabel="الكمية" keyboardType="number-pad" maxLength={10}
        onChangeText={value => {
          clearResult();
          setQuantity(value.replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)));
        }} style={{ ...control, color: theme.color }} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void load()} style={control}>
        <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ التحقق" : "احسب سعر الكمية"}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>{error}</Text> : null}
      {estimate ? <View style={{ gap: 4 }} accessibilityLiveRegion="polite">
        <Text style={{ color: theme.color }}>سعر الوحدة الحالي {formatPublicEstimateYer(estimate.unitYer)} ريال يمني</Text>
        <Text testID="offer-estimate-subtotal" style={{ color: theme.color, fontWeight: "700" }}>
          إجمالي الأصناف {formatPublicEstimateYer(estimate.subtotalYer)} ريال يمني
        </Text>
        <Text style={{ color: theme.colorSecondary }}>تقدير قبل رسوم التوصيل. السعر والكمية قابلان للتغيّر.</Text>
      </View> : null}
      {estimate || recoveryActor ? <Pressable accessibilityRole="button" disabled={savingCart}
        onPress={() => void addDraftToCart()} style={control}>
        <Text style={{ color: theme.interactiveText }}>
          {savingCart ? "جارٍ التحقق" : recoveryActor ? "تحقق من آخر تعديل على السلة" : "أضف إلى سلة المسودة"}
        </Text>
      </Pressable> : null}
      {cartMessage ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
        {cartMessage}
      </Text> : null}
      <Link href={{ pathname: "/cart/[storeId]", params: { storeId: offer.storeId } }}
        style={{ color: theme.interactiveText }}>عرض سلة المتجر</Link>
    </> : null}
  </View>;
}
