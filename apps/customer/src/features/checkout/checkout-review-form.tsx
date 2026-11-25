import { DshPublicError, type CheckoutFulfillmentMode, type CustomerAddress, type CustomerCheckoutReview, type CustomerCheckoutReviewInput, validCustomerCheckoutReviewInput } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { formatExactYer } from "../../components/format-exact-yer";
import { verifyAddressSession } from "../addresses/address-transport";
import DeliveryAddressReview from "./delivery-address-review";
import FulfillmentChoice from "./fulfillment-choice";
import RecipientForm from "./recipient-form";
import { readCheckoutReview } from "./checkout-review-transport";

const emptyRecipient = () => ({ purpose: "SELF" as "SELF" | "OTHER", name: "", phone: "", instructions: "" });
type AddressSelection = Pick<CustomerAddress, "id" | "version">;
export type CheckoutInputDraft = Readonly<{
  recipient: ReturnType<typeof emptyRecipient>;
  mode: CheckoutFulfillmentMode | null;
}>;
export default function CheckoutReviewForm({ actorId, storeId, cartVersion, initialDraft, onDraftChange }: Readonly<{
  actorId: string; storeId: string; cartVersion: number;
  initialDraft?: CheckoutInputDraft | undefined;
  onDraftChange?: ((scope: string, draft: CheckoutInputDraft | null) => void) | undefined;
}>) {
  const { theme } = useMobileAppearance();
  const scope = JSON.stringify([actorId, storeId, cartVersion]);
  const [recipient, setRecipient] = useState(() => initialDraft?.recipient ?? emptyRecipient());
  const [mode, setMode] = useState<CheckoutFulfillmentMode | null>(initialDraft?.mode ?? null);
  const [address, setAddress] = useState<AddressSelection | null>(null);
  const [result, setResult] = useState<CustomerCheckoutReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [admitted, setAdmitted] = useState(false);
  const active = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => {
    active.current?.abort(); active.current = null;
    setResult(null); setBusy(false); setError("");
  }, []);
  const conceal = useCallback(() => {
    invalidate(); setAddress(null); setAdmitted(false);
  }, [invalidate]);
  const clear = useCallback(() => {
    conceal(); setRecipient(emptyRecipient()); setMode(null); onDraftChange?.(scope, null);
  }, [conceal, scope, onDraftChange]);
  useEffect(() => {
    let controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let visible = true;
    let checking: AbortSignal | null = null;
    const stop = () => {
      visible = false; controller.abort(); clearTimeout(expiry); conceal();
    };
    const verify = async () => {
      if (!visible || controller.signal.aborted || checking === controller.signal) return;
      const signal = controller.signal;
      checking = signal;
      try {
        const session = await verifyAddressSession(signal, actorId);
        if (signal.aborted || !visible) return;
        clearTimeout(expiry);
        const remaining = Date.parse(session.sessionExpiresAt) - Date.now();
        if (!Number.isFinite(remaining) || remaining <= 0) { conceal(); return; }
        expiry = setTimeout(() => { conceal(); void verify(); }, Math.min(2147483647, remaining));
        setAdmitted(true);
      } catch (failure) {
        if (!signal.aborted && visible) {
          clearTimeout(expiry);
          if (failure instanceof DshPublicError && [401, 403].includes(failure.status)) {
            clear();
          } else conceal();
        }
      } finally {
        if (checking === signal) checking = null;
      }
    };
    const resume = () => { controller.abort(); controller = new AbortController(); visible = true; void verify(); };
    void verify();
    const timer = setInterval(() => void verify(), 15000);
    if (Platform.OS === "web") {
      const visibility = () => { if (document.visibilityState === "hidden") stop(); else resume(); };
      window.addEventListener("blur", stop); window.addEventListener("focus", resume);
      document.addEventListener("visibilitychange", visibility);
      return () => { controller.abort(); clearTimeout(expiry); clearInterval(timer); active.current?.abort();
        window.removeEventListener("blur", stop); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", visibility); };
    }
    const listener = AppState.addEventListener("change", state => { if (state === "active") resume(); else stop(); });
    return () => { controller.abort(); clearTimeout(expiry); clearInterval(timer); active.current?.abort(); listener.remove(); };
  }, [actorId, clear, conceal]);
  const selectAddress = useCallback((value: AddressSelection | null) => { invalidate(); setAddress(value); }, [invalidate]);
  const input: CustomerCheckoutReviewInput | null = mode ? {
    expectedCartVersion: cartVersion, recipientPurpose: recipient.purpose, fulfillmentMode: mode,
    ...(mode !== "CUSTOMER_PICKUP" && address ? { addressId: address.id, expectedAddressVersion: address.version } : {}),
    ...(recipient.purpose === "OTHER" ? { recipientName: recipient.name.trim(), recipientPhone: recipient.phone.trim(),
      ...(mode !== "CUSTOMER_PICKUP" && recipient.instructions.trim() ? { deliveryInstructions: recipient.instructions.trim() } : {}) } : {}),
  } : null;
  const valid = admitted && input !== null && validCustomerCheckoutReviewInput(input);
  async function review() {
    if (!valid || !input || active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setResult(null); setError("");
    try {
      const read = await readCheckoutReview(actorId, storeId, input, controller.signal);
      if (controller.signal.aborted || active.current !== controller) return;
      if (read.kind === "signed-out") { clear(); setError("انتهت جلسة العميل. أعد فتح المراجعة."); return; }
      if (read.kind === "ready") setResult(read.review);
      else setError("تعذّر التحقق من المراجعة لدى DSH. راجع السلة والعنوان وحاول مجددًا.");
    } catch {
      if (!controller.signal.aborted && active.current === controller) {
        setError("تعذّر التحقق من المراجعة. حاول مجددًا.");
      }
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  if (!admitted) return <Text style={{ color: theme.colorSecondary }}>{error || "جارٍ التحقق من جلسة العميل للمراجعة."}</Text>;
  return <View testID="checkout-review-inputs" style={{ gap: 12 }}>
    <FulfillmentChoice value={mode} onChange={next => {
      invalidate(); setMode(next); onDraftChange?.(scope, { recipient, mode: next });
      if (next === "CUSTOMER_PICKUP") setAddress(null);
    }} />
    {mode && mode !== "CUSTOMER_PICKUP" ? <DeliveryAddressReview actorId={actorId} storeId={storeId} onSelectionChange={selectAddress} /> : null}
    <RecipientForm value={recipient} pickup={mode === "CUSTOMER_PICKUP"} onChange={next => {
      invalidate(); setRecipient(next); onDraftChange?.(scope, { recipient: next, mode });
    }} />
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !valid || busy }} disabled={!valid || busy}
      style={{ minHeight: 44, padding: 12, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 8, opacity: valid && !busy ? 1 : 0.5 }}
      onPress={() => void review()}>
      <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ التحقق..." : "مراجعة البيانات لدى DSH"}</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{error}</Text> : null}
    {result ? <View testID="checkout-owner-input-review" style={{ gap: 8 }}>
      <Text style={{ color: theme.color }}>مجموع البضائع المراجع: {formatExactYer(BigInt(result.merchandise.merchandiseSubtotalYer))} ريال يمني</Text>
      <Text style={{ color: theme.colorSecondary }}>تمت مراجعة صيغة بيانات المستلم والنسخة الحالية للسلة لدى DSH.</Text>
      {result.delivery ? <Text style={{ color: theme.colorSecondary }}>{result.delivery.status === "SERVICEABLE" ? "العنوان ضمن النطاق الجغرافي." : "العنوان خارج النطاق الجغرافي."}</Text> : null}
      {result.delivery && (result.distanceFeeEstimate ?
        <Text testID="checkout-distance-fee-estimate" style={{ color: theme.color }}>تقدير رسوم المسافة: {formatExactYer(BigInt(result.distanceFeeEstimate.feeYer))} ريال يمني (غير قابل للدفع)</Text>
        : <Text testID="checkout-distance-fee-unavailable" style={{ color: theme.colorSecondary }}>تقدير رسوم المسافة غير متاح من DSH.</Text>)}
      <Text style={{ color: theme.colorSecondary }}>
        {result.storeSchedule.status === "OPEN_BY_SCHEDULE" ? "المتجر ضمن ساعات العمل، دون اعتماد طريقة التنفيذ."
          : result.storeSchedule.status === "PAUSED" ? "المتجر متوقف مؤقتًا."
          : result.storeSchedule.status === "CLOSED_BY_SCHEDULE" ? "المتجر خارج ساعات العمل."
          : "لم تتوفر أدلة كافية على ساعات عمل المتجر."}
      </Text>
      <Text accessibilityRole="alert" style={{ color: theme.warningText }}>لم تُعتمد طريقة التنفيذ أو رسومها أو تخصيص الدفع. لا يمكن تأكيد الطلب.</Text>
    </View> : null}
  </View>;
}
