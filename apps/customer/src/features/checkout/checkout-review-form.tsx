import {
  type CheckoutFulfillmentMode,
  type CheckoutSalesChannel,
  type CustomerAddress,
  type CustomerCheckoutReview,
  type CustomerCheckoutReviewInput,
  DshPublicError,
  validCustomerCheckoutReviewInput,
} from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { formatExactYer } from "../../components/format-exact-yer";
import { verifyAddressSession } from "../addresses/address-transport";
import DeliveryAddressReview from "./delivery-address-review";
import FulfillmentChoice from "./fulfillment-choice";
import RecipientForm from "./recipient-form";
import { readCheckoutReview } from "./checkout-review-transport";

type Recipient = { purpose: "SELF" | "OTHER"; name: string; phone: string; instructions: string };
type AddressSelection = Pick<CustomerAddress, "id" | "version">;
export type CheckoutInputDraft = Readonly<{
  recipient: Recipient;
  mode: CheckoutFulfillmentMode | null;
  salesChannel: CheckoutSalesChannel | null;
}>;
type ReviewState = { kind: "idle" } | { kind: "pending" } |
  { kind: "ready"; result: CustomerCheckoutReview } | { kind: "failed"; message: string };

const channels: readonly (readonly [CheckoutSalesChannel, string])[] = [
  ["DIRECT", "البيع الخاص المباشر"],
  ["MARKETPLACE", "سوق بثواني"],
];
function emptyDraft(): CheckoutInputDraft {
  return { recipient: { purpose: "SELF", name: "", phone: "", instructions: "" }, mode: null, salesChannel: null };
}
function channelName(channel: CheckoutSalesChannel): string {
  return channel === "DIRECT" ? "البيع الخاص المباشر" : "سوق بثواني";
}
function reviewInput(draft: CheckoutInputDraft, address: AddressSelection | null, cartVersion: number): CustomerCheckoutReviewInput | null {
  const { mode, salesChannel, recipient } = draft;
  if (!mode || !salesChannel) return null;
  const delivery = mode !== "CUSTOMER_PICKUP";
  const other = recipient.purpose === "OTHER";
  const instructions = recipient.instructions.trim();
  return {
    expectedCartVersion: cartVersion,
    salesChannel,
    recipientPurpose: recipient.purpose,
    fulfillmentMode: mode,
    ...(delivery && address ? { addressId: address.id, expectedAddressVersion: address.version } : {}),
    ...(other ? {
      recipientName: recipient.name.trim(), recipientPhone: recipient.phone.trim(),
      ...(delivery && instructions ? { deliveryInstructions: instructions } : {}),
    } : {}),
  };
}

export default function CheckoutReviewForm({ actorId, storeId, cartVersion, initialDraft, onDraftChange }: Readonly<{
  actorId: string; storeId: string; cartVersion: number;
  initialDraft?: CheckoutInputDraft | undefined;
  onDraftChange?: ((scope: string, draft: CheckoutInputDraft | null) => void) | undefined;
}>) {
  const { theme } = useMobileAppearance();
  // The parent keys this form by the exact owner/cart scope.
  const scope = JSON.stringify([actorId, storeId, cartVersion]);
  const [draft, setDraft] = useState<CheckoutInputDraft>(() => initialDraft
    ? { ...initialDraft, recipient: { ...initialDraft.recipient } } : emptyDraft());
  const [address, setAddress] = useState<AddressSelection | null>(null);
  const [state, setState] = useState<ReviewState>({ kind: "idle" });
  const [admitted, setAdmitted] = useState(false);
  const admission = useRef(false);
  const active = useRef<AbortController | null>(null);

  const cancelReview = useCallback(() => {
    const prior = active.current;
    active.current = null;
    prior?.abort();
    setState({ kind: "idle" });
  }, []);
  const conceal = useCallback(() => {
    admission.current = false;
    cancelReview();
    setAddress(null);
    setAdmitted(false);
  }, [cancelReview]);
  const discard = useCallback(() => {
    conceal();
    setDraft(emptyDraft());
    onDraftChange?.(scope, null);
  }, [conceal, scope, onDraftChange]);

  // Session admission is foreground-only and expires independently of the UI.
  // No result or event from a hidden/obsolete session may reveal the draft.
  useEffect(() => {
    let controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let checking: AbortSignal | null = null;
    const foreground = () => Platform.OS === "web"
      ? document.visibilityState === "visible" && document.hasFocus()
      : AppState.currentState === "active";
    let visible = foreground();
    function stop() {
      visible = false;
      controller.abort();
      clearTimeout(expiry);
      conceal();
    }
    async function verify() {
      const signal = controller.signal;
      if (!visible || signal.aborted || checking === signal) return;
      checking = signal;
      try {
        const session = await verifyAddressSession(signal, actorId);
        if (signal.aborted || !visible) return;
        clearTimeout(expiry);
        const remaining = Date.parse(session.sessionExpiresAt) - Date.now();
        if (!Number.isFinite(remaining) || remaining <= 0) {
          conceal();
          return;
        }
        expiry = setTimeout(() => {
          conceal();
          void verify();
        }, Math.min(2147483647, remaining));
        admission.current = true;
        setAdmitted(true);
      } catch (failure) {
        if (signal.aborted || !visible) return;
        clearTimeout(expiry);
        if (failure instanceof DshPublicError && [401, 403].includes(failure.status)) discard();
        else conceal();
      } finally {
        if (checking === signal) checking = null;
      }
    }
    function resume() {
      if (!foreground()) {
        stop();
        return;
      }
      controller.abort();
      controller = new AbortController();
      visible = true;
      void verify();
    }
    function dispose() {
      visible = false;
      admission.current = false;
      controller.abort();
      clearTimeout(expiry);
      clearInterval(timer);
      const prior = active.current;
      active.current = null;
      prior?.abort();
    }
    const timer = setInterval(() => void verify(), 15000);
    void verify();
    if (Platform.OS === "web") {
      const visibility = () => { if (document.visibilityState === "hidden") stop(); else resume(); };
      window.addEventListener("blur", stop);
      window.addEventListener("focus", resume);
      document.addEventListener("visibilitychange", visibility);
      return () => {
        dispose();
        window.removeEventListener("blur", stop);
        window.removeEventListener("focus", resume);
        document.removeEventListener("visibilitychange", visibility);
      };
    }
    const subscription = AppState.addEventListener("change", next => { if (next === "active") resume(); else stop(); });
    return () => { dispose(); subscription.remove(); };
  }, [actorId, conceal, discard]);

  const selectAddress = useCallback((next: AddressSelection | null) => {
    if (!admission.current) return;
    cancelReview();
    setAddress(next ? { id: next.id, version: next.version } : null);
  }, [cancelReview]);

  function changeDraft(next: CheckoutInputDraft) {
    if (!admission.current) return;
    cancelReview();
    setDraft(next);
    onDraftChange?.(scope, next);
  }
  function changeChannel(channel: CheckoutSalesChannel) {
    if (active.current || channel === draft.salesChannel) return;
    changeDraft({ ...draft, salesChannel: channel });
  }
  function changeMode(mode: CheckoutFulfillmentMode) {
    if (!admission.current) return;
    changeDraft({ ...draft, mode });
    if (mode === "CUSTOMER_PICKUP") setAddress(null);
  }

  const input = reviewInput(draft, address, cartVersion);
  const valid = admitted && input !== null && validCustomerCheckoutReviewInput(input);
  const busy = state.kind === "pending";
  async function submitReview() {
    if (!admission.current || !valid || !input || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setState({ kind: "pending" });
    try {
      const read = await readCheckoutReview(actorId, storeId, input, controller.signal);
      if (!admission.current || controller.signal.aborted || active.current !== controller) return;
      if (read.kind === "signed-out") {
        discard();
        setState({ kind: "failed", message: "انتهت جلسة العميل. أعد فتح المراجعة." });
      } else if (read.kind === "ready") {
        setState({ kind: "ready", result: read.review });
      } else {
        setState({ kind: "failed", message: "تعذّر التحقق من المراجعة لدى DSH. راجع السلة والعنوان وحاول مجددًا." });
      }
    } catch {
      if (admission.current && !controller.signal.aborted && active.current === controller) {
        setState({ kind: "failed", message: "تعذّر التحقق من المراجعة. حاول مجددًا." });
      }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  const error = state.kind === "failed" ? state.message : "";
  const result = state.kind === "ready" ? state.result : null;
  if (!admitted) return <Text style={{ color: theme.colorSecondary }}>{error || "جارٍ التحقق من جلسة العميل للمراجعة."}</Text>;

  return (
    <View testID="checkout-review-inputs" style={{ gap: 12 }}>
      <Text style={{ color: theme.color, fontWeight: "700" }}>قناة البيع المطلوبة للمراجعة</Text>
      <Text style={{ color: theme.colorSecondary }}>تتحقق DSH من أهلية القناة؛ اختيارها لا يفعّل البيع أو الدفع.</Text>
      {/* Selected buttons use the native Web press responder for Enter and Space;
          no custom radio widget or platform-specific keyboard engine. */}
      {channels.map(([channel, name]) => {
        const selected = draft.salesChannel === channel;
        return (
          <Pressable key={channel} testID={"checkout-sales-channel-" + channel}
            accessibilityRole="button" accessibilityLabel={name}
            accessibilityState={{ selected, disabled: busy }} disabled={busy}
            style={{ minHeight: 44, padding: 12, borderWidth: 1, borderColor: theme.borderColor,
              borderRadius: 8, backgroundColor: selected ? theme.actionSoft : theme.surface }}
            onPress={() => changeChannel(channel)}>
            <Text style={{ color: theme.color }}>{name}</Text>
          </Pressable>
        );
      })}
      <FulfillmentChoice value={draft.mode} onChange={changeMode} />
      {draft.mode && draft.mode !== "CUSTOMER_PICKUP"
        ? <DeliveryAddressReview actorId={actorId} storeId={storeId} onSelectionChange={selectAddress} /> : null}
      <RecipientForm value={draft.recipient} pickup={draft.mode === "CUSTOMER_PICKUP"}
        onChange={recipient => changeDraft({ ...draft, recipient: { ...recipient } })} />
      <Pressable testID="checkout-submit-review" accessibilityRole="button"
        accessibilityState={{ disabled: !valid || busy }} disabled={!valid || busy}
        style={{ minHeight: 44, padding: 12, borderWidth: 1, borderColor: theme.borderColor,
          borderRadius: 8, opacity: valid && !busy ? 1 : 0.5 }}
        onPress={() => void submitReview()}>
        <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ التحقق..." : "مراجعة البيانات لدى DSH"}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{error}</Text> : null}
      {result ? (
        <View testID="checkout-owner-input-review" style={{ gap: 8 }}>
          <Text style={{ color: theme.color }}>مجموع البضائع المراجع: {formatExactYer(BigInt(result.merchandise.merchandiseSubtotalYer))} ريال يمني</Text>
          <Text style={{ color: theme.colorSecondary }}>قناة البيع المراجعة: {channelName(result.salesChannel)}</Text>
          <Text style={{ color: theme.colorSecondary }}>تمت مراجعة صيغة بيانات المستلم والنسخة الحالية للسلة لدى DSH.</Text>
          {result.delivery ? <Text style={{ color: theme.colorSecondary }}>{result.delivery.status === "SERVICEABLE" ? "العنوان ضمن النطاق الجغرافي." : "العنوان خارج النطاق الجغرافي."}</Text> : null}
          {result.delivery && (result.distanceFeeEstimate
            ? <Text testID="checkout-distance-fee-estimate" style={{ color: theme.color }}>تقدير رسوم المسافة: {formatExactYer(BigInt(result.distanceFeeEstimate.feeYer))} ريال يمني (غير قابل للدفع)</Text>
            : <Text testID="checkout-distance-fee-unavailable" style={{ color: theme.colorSecondary }}>تقدير رسوم المسافة غير متاح من DSH.</Text>)}
          <Text style={{ color: theme.colorSecondary }}>
            {result.storeSchedule.status === "OPEN_BY_SCHEDULE" ? "المتجر ضمن ساعات العمل، دون اعتماد طريقة التنفيذ."
              : result.storeSchedule.status === "PAUSED" ? "المتجر متوقف مؤقتًا."
              : result.storeSchedule.status === "CLOSED_BY_SCHEDULE" ? "المتجر خارج ساعات العمل."
              : "لم تتوفر أدلة كافية على ساعات عمل المتجر."}
          </Text>
          {result.cityFulfillmentPolicy ? <Text testID="checkout-city-fulfillment-policy"
            style={{ color: result.cityFulfillmentPolicy.status === "DENIED_BY_CITY_POLICY" ? theme.warningText : theme.colorSecondary }}>
            {result.cityFulfillmentPolicy.status === "ALLOWED_BY_CITY_POLICY" ? "سياسة المدينة تسمح بالطريقة المختارة."
              : result.cityFulfillmentPolicy.status === "DENIED_BY_CITY_POLICY" ? "سياسة المدينة تمنع الطريقة المختارة لهذا المتجر."
              : "لم تُضبط سياسة المدينة لطرق التنفيذ لهذا المتجر."}
          </Text> : null}
          <Text accessibilityRole="alert" style={{ color: theme.warningText }}>لا يمكن تأكيد الطلب قبل اعتماد طريقة التنفيذ والرسوم وتخصيص الدفع.</Text>
        </View>
      ) : null}
    </View>
  );
}
