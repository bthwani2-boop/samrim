import { DshPublicError, estimatePublicOffer, parseOfferEstimateQuantity, type PublicOffer, type PublicOfferEstimate } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { resolvePublicStoreOrigin } from "../stores/public-store-origin";

const formatYER = new Intl.NumberFormat("ar-YE");

export default function OfferEstimate({ offer }: Readonly<{ offer: PublicOffer }>) {
  const { theme } = useMobileAppearance();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [estimate, setEstimate] = useState<PublicOfferEstimate>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useFocusEffect(useCallback(() => () => {
    pending.current?.abort();
    pending.current = null;
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
        <Text style={{ color: theme.color }}>سعر الوحدة الحالي {formatYER.format(BigInt(estimate.unitYer))} ريال يمني</Text>
        <Text testID="offer-estimate-subtotal" style={{ color: theme.color, fontWeight: "700" }}>
          إجمالي الأصناف {formatYER.format(BigInt(estimate.subtotalYer))} ريال يمني
        </Text>
        <Text style={{ color: theme.colorSecondary }}>تقدير قبل رسوم التوصيل. السعر والكمية قابلان للتغيّر.</Text>
      </View> : null}
    </> : null}
  </View>;
}
