import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { previewLineSubtotalYer, summarizeCartPreview } from "../cart/cart-preview";
import { type CartReadState, type MerchandiseEstimateReadState, readVerifiedCart, readVerifiedCartMerchandiseEstimate } from "../cart/cart-transport";
import { readCheckoutFunding } from "./checkout-funding";
import type { CheckoutFundingState } from "./checkout-funding-state";
import FulfillmentChoice from "./fulfillment-choice";
import PaymentSelection from "./payment-selection";
import RecipientForm from "./recipient-form";

const formatYER = new Intl.NumberFormat("ar-YE");
const storeRule = /^[a-z0-9-]{1,64}$/;

type CurrentCart = Readonly<{ storeId: string; view: CartReadState }>;
type CurrentFunding = Readonly<{ storeId: string; actorId: string; proof: CheckoutFundingState }>;
type CurrentMerchandise = Readonly<{ storeId: string; actorId: string; cartVersion: number; read: MerchandiseEstimateReadState }>;

/**
 * Read-only review of the current DSH-owned Store Cart.
 * This is not a quote, checkout confirmation, inventory reservation or payment.
 * Revisit this screen to re-read current Store Offer prices.
 */
export default function CheckoutScreen() {
  const { theme } = useMobileAppearance();
  const { storeId: param } = useLocalSearchParams<{ storeId?: string }>();
  const storeId = typeof param === "string" && storeRule.test(param) ? param : "";
  const [result, setResult] = useState<CurrentCart | null>(null);
  const [funding, setFunding] = useState<CurrentFunding | null>(null);
  const [merchandise, setMerchandise] = useState<CurrentMerchandise | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const reload = () => setRetry(value => value + 1);
    if (Platform.OS === "web") {
      window.addEventListener("focus", reload);
      return () => window.removeEventListener("focus", reload);
    }
    const listener = AppState.addEventListener("change", status => {
      if (status === "active") reload();
    });
    return () => listener.remove();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately refreshes the same DSH Store review.
  useFocusEffect(useCallback(() => {
    const epoch = ++generation.current;
    const controller = new AbortController();
    let expires: ReturnType<typeof setTimeout> | undefined;
    setResult(null);
    setFunding(null);
    setMerchandise(null);
    if (storeId) {
      void readVerifiedCart(storeId, controller.signal).then(view => {
        if (controller.signal.aborted || generation.current !== epoch) return;
        setResult({ storeId, view });
        if (view.kind !== "ready") return;
        const actorId = view.cart.actorId;
        const cartVersion = view.cart.version;
        // This is the DSH-owned, version-bound merchandise read, not a
        // payable quote. A late response cannot survive focus/account changes.
        void readVerifiedCartMerchandiseEstimate(storeId, cartVersion, actorId, controller.signal)
          .then(read => {
            if (controller.signal.aborted || generation.current !== epoch) return;
            if (read.kind === "signed-out") {
              setResult({ storeId, view: { kind: "signed-out" } });
              setFunding(null);
              setMerchandise(null);
              return;
            }
            const valid = read.kind !== "ready" ||
              (read.estimate.actorId === actorId && read.estimate.storeId === storeId &&
                read.estimate.cartVersion === cartVersion && read.estimate.checkoutReady === false);
            setMerchandise({ storeId, actorId, cartVersion,
              read: valid ? read : { kind: "unavailable" } });
          }).catch(() => {
            if (!controller.signal.aborted && generation.current === epoch) {
              setMerchandise({ storeId, actorId, cartVersion, read: { kind: "unavailable" } });
            }
          });
        // WLT must independently verify this exact Customer before any
        // wallet balance appears alongside the DSH Cart. No financial write.
        void readCheckoutFunding(actorId, controller.signal).then(proof => {
          if (controller.signal.aborted || generation.current !== epoch) return;
          if (proof.kind === "signed-out") {
            setResult({ storeId, view: { kind: "signed-out" } });
            setFunding(null);
            setMerchandise(null);
            return;
          }
          setFunding({ storeId, actorId, proof });
          if (proof.kind === "ready") {
            expires = setTimeout(() => {
              if (!controller.signal.aborted && generation.current === epoch) {
                setFunding(null);
                setResult({ storeId, view: { kind: "signed-out" } });
              }
            }, Math.max(0, proof.expiresAt - Date.now()));
          }
        }).catch(() => {
          if (!controller.signal.aborted && generation.current === epoch) {
            setFunding({ storeId, actorId, proof: { kind: "unavailable" } });
          }
        });
      }).catch(() => {
        if (!controller.signal.aborted && generation.current === epoch) {
          setResult({ storeId, view: { kind: "unavailable" } });
        }
      });
    }
    return () => {
      controller.abort();
      if (expires) clearTimeout(expires);
      generation.current++;
      setResult(null);
      setFunding(null);
      setMerchandise(null);
    };
  }, [storeId, retry]));

  // Never render an old Store's result while a new Store/account is loading.
  // readVerifiedCart independently verifies Identity before and after each DSH read.
  const view = result?.storeId === storeId ? result.view : null;
  const cart = view?.kind === "ready" && view.cart.storeId === storeId ? view.cart : null;
  const preview = cart ? summarizeCartPreview(cart.lines) : null;
  const currentFunding = cart && funding?.storeId === storeId && funding.actorId === cart.actorId
    ? funding.proof : null;
  const currentMerchandise = cart && merchandise?.storeId === storeId &&
    merchandise.actorId === cart.actorId && merchandise.cartVersion === cart.version
    ? merchandise.read : null;
  const ownerMerchandise = cart && currentMerchandise?.kind === "ready" &&
    currentMerchandise.estimate.storeId === storeId &&
    currentMerchandise.estimate.actorId === cart.actorId &&
    currentMerchandise.estimate.cartVersion === cart.version &&
    currentMerchandise.estimate.checkoutReady === false
    ? currentMerchandise.estimate : null;
  const action = {
    minHeight: 44, justifyContent: "center" as const,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10,
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{
        padding: 20, gap: 16, maxWidth: 720, width: "100%", alignSelf: "center",
      }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 26, fontWeight: "700" }}>
          مراجعة السلة قبل الطلب
        </Text>
        <Text style={{ color: theme.colorSecondary, lineHeight: 26 }}>
          تعرض هذه الصفحة بيانات السلة والأسعار الحالية المقروءة من DSH للمتجر المحدد.
          المبالغ تقديرية للبنود فقط ولا تشمل التوصيل أو الخصومات أو الرسوم أو الحجز.
        </Text>
        {!storeId ? (
          <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
            حدد متجرًا صحيحًا من سلة التسوق لعرض مراجعة الطلب.
          </Text>
        ) : !view ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
            جارٍ قراءة سلتك الحالية من DSH...
          </Text>
        ) : view.kind === "signed-out" ? (
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
              سجل الدخول بحساب العميل لعرض السلة الخاصة بك.
            </Text>
            <Link href="/account" style={{ color: theme.interactiveText }}>الانتقال للحساب</Link>
          </View>
        ) : view.kind === "unavailable" || !cart ? (
          <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
            تعذر التحقق من السلة لدى Identity أو DSH. لا توجد أسعار معتمدة حاليًا.
          </Text>
        ) : cart.lines.length === 0 ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
            السلة فارغة؛ أضف عروضًا من صفحة المتجر أولًا.
          </Text>
        ) : (
          <View testID="checkout-cart-review" style={{ gap: 12 }}>
            <Text style={{ color: theme.colorSecondary }}>
              رقم نسخة السلة لدى DSH: {cart.version}
            </Text>
            {cart.lines.map(line => (
              <View key={line.offerId} style={{
                backgroundColor: theme.surface, padding: 14, gap: 8,
                borderRadius: 12, borderWidth: 1, borderColor: theme.borderColor,
              }}>
                <Text style={{ color: theme.color, fontWeight: "700" }}>{line.name}</Text>
                <Text style={{ color: theme.colorSecondary }}>
                  الكمية: {line.quantity} — السعر المعروض للوحدة:
                  {" "}{formatYER.format(BigInt(line.previewUnitYer))} ريال يمني
                </Text>
                <Text style={{ color: theme.colorSecondary }}>
                  إجمالي البند المعروض:
                  {" "}{formatYER.format(previewLineSubtotalYer(line))} ريال يمني
                </Text>
                {!line.previewAvailable ? (
                  <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>
                    هذا العرض غير متاح للطلب حاليًا. راجع السلة.
                  </Text>
                ) : null}
              </View>
            ))}
            <View testID="checkout-wlt-balance-review" style={{
              padding: 16, gap: 8, borderRadius: 12,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor,
            }}>
              <Text style={{ color: theme.color, fontWeight: "700" }}>رصيد المحفظة للمراجعة فقط</Text>
              <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
                {currentFunding?.kind === "ready"
                  ? `رصيد WLT التجريبي الحالي: ${formatYER.format(BigInt(currentFunding.balance.balanceYer))} ريال يمني.`
                  : currentFunding?.kind === "unavailable"
                    ? "تعذّر التحقق من رصيد المحفظة؛ لا يمكن الاعتماد عليه."
                    : "جارٍ التحقق من رصيد هذا الحساب لدى WLT."}
              </Text>
              <Text style={{ color: theme.colorSecondary }}>
                الرصيد المعروض ليس حجزًا أو تخصيصًا لهذا الطلب؛ الدفع وتأكيد الطلب غير متاحين.
              </Text>
            </View>
            {preview ? (
              <View testID="checkout-preview-subtotal" style={{
                padding: 16, gap: 8, borderRadius: 12,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor,
              }}>
                <Text style={{ color: theme.color, fontWeight: "700" }}>
                  مجموع البنود المتاحة المعروض:
                  {" "}{formatYER.format(preview.availableSubtotalYer)} ريال يمني
                </Text>
                {preview.unavailableLines > 0 ? (
                  <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>
                    بنود غير متاحة: {preview.unavailableLines}. لا يمكن اعتماد الطلب.
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View testID="checkout-dsh-merchandise-estimate" style={{
              padding: 16, gap: 8, borderRadius: 12,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor,
            }}>
              <Text style={{ color: theme.color, fontWeight: "700" }}>
                تقدير البضائع لدى DSH للنسخة الحالية
              </Text>
              {ownerMerchandise ? (
                <Text testID="checkout-owner-merchandise-subtotal" style={{ color: theme.color }}>
                  مجموع البضائع المتحقق من DSH:{" "}
                  {formatYER.format(BigInt(ownerMerchandise.merchandiseSubtotalYer))} ريال يمني
                </Text>
              ) : (
                <Text accessibilityRole={currentMerchandise?.kind === "unavailable" ||
                  currentMerchandise?.kind === "ready" ? "alert" : undefined}
                  style={{ color: theme.colorSecondary }}>
                  {currentMerchandise?.kind === "unavailable" || currentMerchandise?.kind === "ready"
                    ? "تعذّر التحقق من تقدير البضائع؛ راجع السلة وحاول التحديث."
                    : "جارٍ التحقق من تقدير البضائع لدى DSH."}
                </Text>
              )}
              <Text style={{ color: theme.colorSecondary }}>
                التقدير للبضائع فقط ولا يشمل التوصيل أو الرسوم أو الدفع أو حجز المخزون،
                ولا يتيح تأكيد الطلب.
              </Text>
            </View>
          </View>
        )}
        {storeId && (view?.kind === "unavailable" || currentFunding?.kind === "unavailable" ||
          currentMerchandise?.kind === "unavailable") ? (
          <Pressable accessibilityRole="button" style={{ ...action, alignSelf: "flex-start" }}
            onPress={() => setRetry(value => value + 1)}>
            <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
          </Pressable>
        ) : null}
        {storeId ? (
          <Link href={{ pathname: "/cart/[storeId]", params: { storeId } }}
            style={{ color: theme.interactiveText }}>
            العودة إلى سلة المتجر
          </Link>
        ) : null}
        <View style={{
          padding: 16, gap: 8, borderRadius: 12,
          borderWidth: 1, borderColor: theme.borderColor, backgroundColor: theme.surface,
        }}>
          <Text accessibilityRole="alert" testID="checkout-confirmation-unavailable"
            style={{ color: theme.warningText, fontWeight: "700", fontSize: 17 }}>
            تأكيد الطلب والدفع غير متاحين
          </Text>
          <View style={{ gap: 10 }}>
            <RecipientForm label="المستلم والعنوان: لم يصدر بعد تحقق DSH من بيانات التسليم لهذا الطلب." />
            <FulfillmentChoice label="طريقة الاستلام أو التوصيل: لم تعتمد DSH أهلية أي طريقة لهذا الطلب." />
            <PaymentSelection label="الدفع: لم يصدر تخصيص مالي معتمد من WLT لهذا الطلب." />
          </View>
          <Text style={{ color: theme.color, lineHeight: 26 }}>
            يلزم تسعير ومدة صلاحية عرض موثقان من DSH، والتحقق من العنوان وطريقة
            التوصيل، وتخصيص الدفع لدى WLT، قبل السماح بتأكيد أي طلب.
            هذه المراجعة لا تنشئ طلبًا ولا تخصم رصيدًا أو تحجز مخزونًا.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
