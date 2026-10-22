import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Cart, type CheckoutQuote, type CheckoutRequest, cashCollectionPartyLabel, checkoutWalletAllocation, createDshMobileClient, type DeliveryAddress, type FulfillmentMode, formatMoney, fulfillmentModeLabel, formatQuantity, type Order, orderStateLabel, orderPaymentDisclosure, paymentMethodLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, Link, useRouter } from "expo-router";
import * as SecureStore from "../../bootstrap/compatible-storage";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { premium } from "../order-experience/premium-order-ui";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { recordPendingDiscoveryConversion } from "../store-discovery/discovery-analytics";
import { checkoutRecipient, DeliveryRecipientForm, deliveryRecipientIsValid, type DeliveryRecipientInput } from "./delivery-recipient-form";

type CartState = { kind: "loading" } | { kind: "empty" } | { kind: "ready"; cart: Cart } | { kind: "error" };
type QuoteState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; quote: CheckoutQuote } | { kind: "invalid" } | { kind: "error"; message: string };
type WalletState = { kind: "loading" } | { kind: "ready"; availableMinor: number } | { kind: "error" };
type PendingCartCheckoutAttempt = Readonly<{ version: 1; actorID: string; storeID: string; cartID: string; idempotencyKey: string; correlationID: string; request: CheckoutRequest; expectedCartVersion: number }>;

function pendingCartCheckoutKey(actorID: string, storeID: string): string {
  return `bthwani.client.cart-checkout.pending.v1.${encodeURIComponent(actorID)}.${encodeURIComponent(storeID)}`;
}

function parsePendingCartCheckout(raw: string | null, actorID: string, storeID: string): PendingCartCheckoutAttempt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingCartCheckoutAttempt>;
    if (value.version !== 1 || value.actorID !== actorID || value.storeID !== storeID || typeof value.cartID !== "string" || !value.cartID || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 8 || value.idempotencyKey.length > 128 || typeof value.correlationID !== "string" || value.correlationID.length < 8 || value.correlationID.length > 128 || !Number.isSafeInteger(value.expectedCartVersion) || Number(value.expectedCartVersion) < 1 || !value.request || value.request.cartId !== value.cartID || value.request.storeId !== storeID) return null;
    return value as PendingCartCheckoutAttempt;
  } catch {
    return null;
  }
}

// Checkout receipts predating accepted quote totals may be reconciled by
// canonical Order readback but must never be resubmitted as a fresh charge.
function pendingCheckoutHasAcceptedTotal(attempt: PendingCartCheckoutAttempt): boolean {
  const total = attempt.request.expectedTotalAmountMinor;
  return typeof total === "number" && Number.isSafeInteger(total) && total > 0;
}

function definitiveCheckoutRejection(error: unknown): boolean {
  const code = errorCode(error);
  return ["CHECKOUT_PAYMENT_RECONCILED", "STALE_CHECKOUT", "INVALID_INPUT", "INVALID_PAYMENT_ALLOCATION", "INVALID_RECIPIENT", "INSUFFICIENT_CUSTOMER_BALANCE", "OFFER_UNAVAILABLE", "CART_CLOSED", "CART_EMPTY", "INVENTORY_INSUFFICIENT", "INVENTORY_CONFLICT", "PROMOTION_UNAVAILABLE", "UNSERVICEABLE", "FULFILLMENT_MODE_UNAVAILABLE", "WLT_DELIVERY_FEE_UNAVAILABLE", "NOT_FOUND"].includes(code);
}

function quoteMatchesCheckout(quote: CheckoutQuote, cart: Cart, storeID: string, addressID: string, fulfillmentMode: FulfillmentMode, promotionCode: string): boolean {
  return !cart.lines.some((line) => line.requiresReview)
    && quote.cartId === cart.id
    && quote.storeId === storeID
    && quote.cartVersion === cart.version
    && quote.addressId === addressID
    && quote.fulfillmentMode === fulfillmentMode
    && (quote.promotionCode ?? "") === promotionCode.trim().toUpperCase();
}

const checkoutPaymentMethods: Readonly<Record<FulfillmentMode, Order["paymentMethod"]>> = {
  BTHWANI_CAPTAIN: "CASH_ON_DELIVERY",
  PARTNER_CAPTAIN: "CASH_AT_STORE",
  CUSTOMER_PICKUP: "CASH_AT_STORE",
};

const checkoutFulfillmentInstructions: Readonly<Record<FulfillmentMode, string>> = {
  BTHWANI_CAPTAIN: "يُسند الطلب إلى كابتن بثواني بعد جاهزية المتجر.",
  PARTNER_CAPTAIN: "يختار المتجر أحد كباتنه لتوصيل الطلب إلى عنوانك.",
  CUSTOMER_PICKUP: "استلم الطلب بنفسك من المتجر بعد جاهزيته.",
};

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { kind?: unknown; status?: unknown }).kind === "http" && (error as { status?: unknown }).status === 404);
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
}

function cartMutationErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === "CHECKOUT_PAYMENT_RECONCILED") return "أُلغيت محاولة الدفع السابقة بأمان؛ حدّث السلة ثم ابدأ الإتمام من جديد.";
  if (code === "STALE_CHECKOUT") return "تغيرت السلة أو بيانات المنتج. حدّثنا السلة؛ راجعها ثم أعد المحاولة.";
  if (code === "INVALID_INPUT") return "تعذر قبول الكمية أو الخيارات الحالية. حدّث السلة ثم أعد المحاولة.";
  if (code === "INVALID_PAYMENT_ALLOCATION") return "مبلغ الرصيد يجب ألا يتجاوز إجمالي الطلب.";
  if (code === "INVALID_RECIPIENT") return "بيانات مستلم الطلب غير صالحة. راجع الاسم والرقم اليمني المحلي أو الدولي.";
  if (code === "INSUFFICIENT_CUSTOMER_BALANCE") return "الرصيد المتاح أقل من المبلغ المحدد. خفّض المبلغ أو حدّث رصيدك.";
  if (code === "OFFER_UNAVAILABLE") return "لم يعد أحد المنتجات متاحًا. حدّث السلة لمراجعة المنتجات الحالية.";
  if (code === "CART_CLOSED") return "أُغلقت السلة. افتح كتالوج المتجر لبدء سلة جديدة.";
  return "تعذر تحديث السلة. أعد المحاولة بعد قراءة الحالة الحالية.";
}

function quoteFailureMessage(error: unknown, appliedCode: string): string {
  const code = errorCode(error);
  if (code === "PROMOTION_UNAVAILABLE") return "هذا العرض غير متاح لهذا المتجر أو لم تعد شروطه مستوفاة. امسح الرمز واضغط «تطبيق» لإعادة حساب الإجمالي دون خصم، أو اختر عرضًا آخر.";
  if (code === "INVALID_INPUT" && appliedCode) return "رمز العرض غير صالح. صححه أو امسحه ثم اضغط «تطبيق» لإعادة حساب الإجمالي.";
  if (code === "UNSERVICEABLE") return "العنوان المختار خارج نطاق توصيل المتجر. اختر عنوانًا مؤهلًا ثم أعد حساب الإجمالي.";
  if (code === "FULFILLMENT_MODE_UNAVAILABLE") return "طريقة الاستلام المختارة لم تعد متاحة؛ اختر طريقة أخرى ثم أعد حساب الإجمالي.";
  if (code === "WLT_DELIVERY_FEE_UNAVAILABLE") return "تعذر الحصول على رسوم التوصيل حاليًا؛ أعد المحاولة قبل تأكيد الطلب.";
  return "تعذر حساب الإجمالي. حدّث السلة أو أعد المحاولة قبل الإتمام.";
}

function isQuantityAllowed(line: Cart["lines"][number], quantity: number): boolean {
  return quantity >= line.quantityMinBaseUnits && quantity <= line.quantityMaxBaseUnits && (quantity - line.quantityMinBaseUnits) % line.quantityStepBaseUnits === 0;
}

export type CheckoutFooterState = Readonly<{ label: string; total: string; disabled: boolean; busy: boolean }>;
export function CartCheckout({ storeId, addresses, serviceableAddressId, fulfillmentMode, initialPromotionCode = "", onFooterChange, checkoutAction }: {
  storeId: string; addresses: ReadonlyArray<DeliveryAddress>; serviceableAddressId?: string | undefined;
  fulfillmentMode: FulfillmentMode; initialPromotionCode?: string;
  onFooterChange?: (state: CheckoutFooterState | null) => void; checkoutAction?: MutableRefObject<() => void>;
}) {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<CartState>({ kind: "loading" });
  const [quote, setQuote] = useState<QuoteState>({ kind: "idle" });
  const [wallet, setWallet] = useState<WalletState>({ kind: "loading" });
  const [useWalletBalance, setUseWalletBalance] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState<PendingCartCheckoutAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLineId, setBusyLineId] = useState("");
  const [error, setError] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [showPromotion, setShowPromotion] = useState(Boolean(initialPromotionCode));
  const [showItems, setShowItems] = useState(false);
  const [promotionCode, setPromotionCode] = useState(initialPromotionCode.trim().toUpperCase());
  const [appliedPromotionCode, setAppliedPromotionCode] = useState("");
  useEffect(() => {
    setPromotionCode(initialPromotionCode.trim().toUpperCase());
    setAppliedPromotionCode("");
  }, [initialPromotionCode]);
  const [recipient, setRecipient] = useState<DeliveryRecipientInput>({ mode: "SELF" });
  const quoteRequestID = useRef(0);
  const checkoutSubmitting = useRef(false);
  const loadRequestID = useRef(0);
  const walletRequestID = useRef(0);
  const mounted = useRef(false);
  const mutationBusy = busy || Boolean(busyLineId);
  const pickupMode = fulfillmentMode === "CUSTOMER_PICKUP";
  const paymentMethod = checkoutPaymentMethods[fulfillmentMode];
  const quoteAddressID = pickupMode ? "" : serviceableAddressId;

  const refreshWallet = useCallback(async (accessToken?: string) => {
    const requestID = ++walletRequestID.current;
    const isCurrent = () => mounted.current && requestID === walletRequestID.current;
    setWallet({ kind: "loading" });
    try {
      const token = accessToken ?? await getUsableIdentityAccessToken();
      const response = await client().readOwnWallet(token);
      if (isCurrent()) setWallet({ kind: "ready", availableMinor: response.state.availableMinor });
    } catch {
      if (isCurrent()) setWallet({ kind: "error" });
    }
  }, []);

  const finishCheckout = useCallback(async (orderResult: Order, _accessToken: string, storageKey: string, isCurrent: () => boolean = () => mounted.current) => {
    if (isCurrent()) {
      setOrder(orderResult);
      setState({ kind: "empty" });
      setPendingCheckout(null);
      void recordPendingDiscoveryConversion(orderResult.id);
    }
    try { await SecureStore.deleteItemAsync(storageKey); } catch { /* Canonical order readback makes the retained attempt safe to reconcile again. */ }
  }, []);

  useEffect(() => {
    // Navigate only after canonical checkout readback, including recovered attempts.
    if (order) router.replace(`/orders/${encodeURIComponent(order.id)}` as Href);
  }, [order, router]);

  const readOrderForCart = useCallback(async (accessToken: string, cartID: string): Promise<Order | null> => {
    const response = await client().listClientOrders(accessToken, 1, cartID);
    return response.orders.find((item) => item.cartId === cartID) ?? null;
  }, []);

  const load = useCallback(async () => {
    if (!mounted.current) return;
    const requestID = ++loadRequestID.current;
    const isCurrent = () => mounted.current && requestID === loadRequestID.current;
    setState({ kind: "loading" });
    setBusy(false);
    quoteRequestID.current += 1;
    setQuote({ kind: "idle" });
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) return;
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CLIENT_SESSION_REQUIRED");
      void refreshWallet(token);
      const actorID = identity.identity.subject.trim();
      const storageKey = pendingCartCheckoutKey(actorID, storeId);
      const rawAttempt = await SecureStore.getItemAsync(storageKey);
      if (!isCurrent()) return;
      const attempt = parsePendingCartCheckout(rawAttempt, actorID, storeId);
      if (rawAttempt && !attempt) throw new Error("PENDING_CART_CHECKOUT_INVALID");
      if (attempt) {
        setPendingCheckout(attempt);
        setBusy(true);
        let existingOrder: Order | null = null;
        try { existingOrder = await readOrderForCart(token, attempt.cartID); } catch { /* Retry with the same durable idempotency facts below. */ }
        if (existingOrder) {
          await finishCheckout(existingOrder, token, storageKey, isCurrent);
          return;
        }
        if (!isCurrent()) return;
        if (!pendingCheckoutHasAcceptedTotal(attempt)) {
          // Keep the existing idempotency evidence until the canonical Order
          // can be read; do not mint a new order with an unaccepted amount.
          setBusy(false);
          setError("هذا طلب قديم لم يثبت فيه المبلغ المؤكد. لم نُعِد إرساله لتجنب طلب أو خصم مكرر. أعد التحقق من الطلب لاحقًا أو اطلب المساعدة.");
          return;
        }
        try {
          const result = await client().checkoutCart(token, attempt.request, attempt.expectedCartVersion, attempt.idempotencyKey, attempt.correlationID);
          await finishCheckout(result.order, token, storageKey, isCurrent);
          return;
        } catch (cause) {
          try { existingOrder = await readOrderForCart(token, attempt.cartID); } catch { existingOrder = null; }
          if (existingOrder) {
            await finishCheckout(existingOrder, token, storageKey, isCurrent);
            return;
          }
          if (definitiveCheckoutRejection(cause)) {
            try { await SecureStore.deleteItemAsync(storageKey); } catch { /* A future entry can still prove absence before reuse. */ }
            if (isCurrent()) {
              setPendingCheckout(null);
              setError(cartMutationErrorMessage(cause));
            }
          } else if (isCurrent()) {
            setError("تعذر تأكيد نتيجة الطلب. بقيت المحاولة محفوظة؛ تحقق منها قبل إنشاء طلب آخر.");
          }
        } finally {
          if (isCurrent()) setBusy(false);
        }
      } else if (isCurrent()) {
        setPendingCheckout(null);
      }
      if (!isCurrent()) return;
      const result = await client().readOpenCart(token, storeId);
      if (isCurrent()) setState(result.cart.lines.length ? { kind: "ready", cart: result.cart } : { kind: "empty" });
    } catch (cause) {
      if (isCurrent()) {
        if (isNotFound(cause)) setState({ kind: "empty" });
        else { console.error("DSH cart read failed", cause); setState({ kind: "error" }); }
      }
    }
  }, [finishCheckout, readOrderForCart, refreshWallet, storeId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadRequestID.current += 1;
      quoteRequestID.current += 1;
      walletRequestID.current += 1;
    };
  }, [load]);

  const refreshQuote = useCallback(async (cart: Cart) => {
    if (cart.lines.some((line) => line.requiresReview)) {
      quoteRequestID.current += 1;
      setQuote({ kind: "invalid" });
      return;
    }
    if (!pickupMode && !serviceableAddressId) {
      quoteRequestID.current += 1;
      setQuote({ kind: "idle" });
      return;
    }
    const requestID = ++quoteRequestID.current;
    setQuote({ kind: "loading" });
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().quoteCheckout(token, { cartId: cart.id, storeId, addressId: quoteAddressID ?? "", fulfillmentMode, ...(appliedPromotionCode ? { promotionCode: appliedPromotionCode } : {}) }, cart.version);
      if (requestID === quoteRequestID.current) setQuote({ kind: "ready", quote: result.quote });
    } catch (cause) {
      console.error("DSH checkout quote failed", cause);
      if (requestID === quoteRequestID.current) setQuote({ kind: "error", message: quoteFailureMessage(cause, appliedPromotionCode) });
    }
  }, [appliedPromotionCode, fulfillmentMode, pickupMode, quoteAddressID, serviceableAddressId, storeId]);

  const readyCart = state.kind === "ready" ? state.cart : null;
  const cartNeedsReview = readyCart?.lines.some((line) => line.requiresReview) ?? false;
  const promotionNeedsApply = promotionCode.trim().toUpperCase() !== appliedPromotionCode;
  const verifiedQuote = readyCart && quote.kind === "ready" && quoteMatchesCheckout(quote.quote, readyCart, storeId, pickupMode ? "" : serviceableAddressId ?? "", fulfillmentMode, appliedPromotionCode) ? quote.quote : null;
  useEffect(() => {
    if (readyCart) void refreshQuote(readyCart);
    else {
      quoteRequestID.current += 1;
      setQuote({ kind: "idle" });
    }
  }, [readyCart, refreshQuote]);

  async function refreshAfterConflict(message: string) {
    await load();
    setError(message);
  }

  async function updateLine(line: Cart["lines"][number], delta: -1 | 1) {
    const nextQuantity = line.quantityBaseUnits + delta * line.quantityStepBaseUnits;
    if (mutationBusy || state.kind !== "ready" || !isQuantityAllowed(line, nextQuantity)) return;
    setBusyLineId(line.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().updateCartLine(token, line.id, { quantityBaseUnits: nextQuantity, selectedModifierOptionIds: line.selectedModifierOptionIds }, state.cart.version);
      setState(result.cart.lines.length ? { kind: "ready", cart: result.cart } : { kind: "empty" });
    } catch (cause) {
      console.error("DSH cart line update failed", cause);
      if (errorCode(cause) === "STALE_CHECKOUT") await refreshAfterConflict(cartMutationErrorMessage(cause));
      else setError(cartMutationErrorMessage(cause));
    } finally {
      setBusyLineId("");
    }
  }

  async function removeLine(line: Cart["lines"][number]) {
    if (mutationBusy || state.kind !== "ready") return;
    setBusyLineId(line.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await client().removeCartLine(token, line.id, state.cart.version);
      setState(result.cart.lines.length ? { kind: "ready", cart: result.cart } : { kind: "empty" });
    } catch (cause) {
      console.error("DSH cart line removal failed", cause);
      if (errorCode(cause) === "STALE_CHECKOUT") await refreshAfterConflict(cartMutationErrorMessage(cause));
      else setError(cartMutationErrorMessage(cause));
    } finally {
      setBusyLineId("");
    }
  }

  async function checkout() {
    if (checkoutSubmitting.current) return;
    const addressID = pickupMode ? "" : serviceableAddressId ?? "";
    if (mutationBusy || state.kind !== "ready" || !state.cart.lines.length || (!pickupMode && !serviceableAddressId) || quote.kind !== "ready" || !quoteMatchesCheckout(quote.quote, state.cart, storeId, addressID, fulfillmentMode, appliedPromotionCode)) return;
    const internalBalanceAmountMinor = checkoutWalletAllocation(quote.quote.totalAmountMinor, wallet.kind === "ready" ? wallet.availableMinor : null, useWalletBalance);
    if (internalBalanceAmountMinor === null) {
      setError("تعذر تحديد مبلغ المحفظة بأمان. أعد قراءة الرصيد أو ادفع نقدًا.");
      return;
    }
    if (!pickupMode && !deliveryRecipientIsValid(recipient)) {
      setError("أدخل اسمًا ورقمًا يمنيًا صحيحًا للمستلم، محليًا أو دوليًا، قبل تأكيد الطلب.");
      return;
    }
    // Acquire synchronously before session/storage awaits so rapid taps cannot create a second checkout identity.
    checkoutSubmitting.current = true;
    setBusy(true);
    try {
      setError("");
      let token: string;
      let actorID: string;
      try {
        token = await getUsableIdentityAccessToken();
        const identity = currentIdentityState();
        if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CLIENT_SESSION_REQUIRED");
        actorID = identity.identity.subject.trim();
      } catch {
        setError("تعذر التحقق من جلسة العميل؛ لم يُرسل الطلب.");
        return;
      }
      const request: CheckoutRequest = { cartId: state.cart.id, storeId, addressId: addressID, fulfillmentMode, expectedTotalAmountMinor: quote.quote.totalAmountMinor, internalBalanceAmountMinor, recipient: checkoutRecipient(recipient, !pickupMode), ...(appliedPromotionCode ? { promotionCode: appliedPromotionCode } : {}) };
      const storageKey = pendingCartCheckoutKey(actorID, storeId);
      const attempt: PendingCartCheckoutAttempt = {
        version: 1, actorID, storeID: storeId, cartID: state.cart.id, expectedCartVersion: state.cart.version,
        idempotencyKey: `cart_checkout_${Crypto.randomUUID()}`, correlationID: `cart_checkout_corr_${Crypto.randomUUID()}`, request,
      };
      try {
        await SecureStore.setItemAsync(storageKey, JSON.stringify(attempt));
      } catch {
        setError("تعذر حفظ محاولة الطلب بأمان؛ لم يُرسل الطلب.");
        return;
      }
      setPendingCheckout(attempt);
      try {
        const result = await client().checkoutCart(token, request, attempt.expectedCartVersion, attempt.idempotencyKey, attempt.correlationID);
        await finishCheckout(result.order, token, storageKey);
      } catch (cause) {
        console.error("DSH checkout failed", cause);
        let existingOrder: Order | null = null;
        try { existingOrder = await readOrderForCart(token, attempt.cartID); } catch { /* Preserve the attempt whenever canonical readback is unavailable. */ }
        if (existingOrder) await finishCheckout(existingOrder, token, storageKey);
        else if (definitiveCheckoutRejection(cause)) {
          try { await SecureStore.deleteItemAsync(storageKey); } catch { /* A future entry still checks canonical orders before retrying. */ }
          setPendingCheckout(null);
          if (errorCode(cause) === "STALE_CHECKOUT") await refreshAfterConflict(cartMutationErrorMessage(cause));
          else setError(cartMutationErrorMessage(cause));
        } else {
          setError("تعذر تأكيد نتيجة الطلب. بقيت محاولة واحدة محفوظة؛ تحقق من حالتها ولا تبدأ طلبًا جديدًا.");
        }
      }
    } finally {
      checkoutSubmitting.current = false;
      setBusy(false);
    }
  }

  const selectedAddress = addresses.find((address) => address.id === serviceableAddressId);
  const selectedBalanceMinor = verifiedQuote ? checkoutWalletAllocation(verifiedQuote.totalAmountMinor, wallet.kind === "ready" ? wallet.availableMinor : null, useWalletBalance) : null;
  const balanceNeedsRead = useWalletBalance && wallet.kind !== "ready";
  const remainingCashMinor = verifiedQuote !== null && selectedBalanceMinor !== null ? verifiedQuote.totalAmountMinor - selectedBalanceMinor : null;
  const canConfirm = Boolean(!mutationBusy && (pickupMode || serviceableAddressId) && verifiedQuote && selectedBalanceMinor !== null && !balanceNeedsRead && !promotionNeedsApply);
  if (checkoutAction) checkoutAction.current = () => { void checkout(); };
  useEffect(() => {
    onFooterChange?.(state.kind === "ready" && !pendingCheckout ? {
      label: "تأكيد الطلب", total: verifiedQuote ? formatMoney(verifiedQuote.totalAmountMinor, verifiedQuote.currency) : "جارٍ الحساب…",
      busy, disabled: !canConfirm,
    } : null);
  }, [onFooterChange, state.kind, pendingCheckout, verifiedQuote, busy, canConfirm]);
  useEffect(() => () => onFooterChange?.(null), [onFooterChange]);
  if (pendingCheckout) return <View style={styles.container} accessibilityLabel="استعادة طلب السلة"><Text style={styles.title}>التحقق من نتيجة الطلب</Text><Text style={styles.warning}>المحاولة محفوظة لهذا الحساب والسلة. سنتحقق من النتيجة أولًا لتجنب إنشاء طلب مكرر.</Text><BthwaniButton busy={busy} disabled={busy} label="تحقق واستعد الطلب" onPress={() => void load()} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</View>;
  return (
    <View style={styles.container} accessibilityLabel="السلة وإتمام الطلب">
      <Text style={styles.title}>ملخص طلبك</Text>
      <Text style={styles.muted}>تُراجع الأسعار والتوفر والعنوان قبل تثبيت الطلب.</Text>
      {state.kind === "loading" ? <View style={styles.state} accessibilityLabel="جارٍ قراءة السلة"><BthwaniSkeleton height={72} /><BthwaniSkeleton height={72} /></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>تعذر قراءة السلة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View> : null}
      {state.kind === "empty" ? <BthwaniSurface tone="inset" style={styles.emptyState}><Text style={styles.lineTitle}>{order ? "تم إنشاء الطلب والسلة الآن فارغة." : "السلة فارغة."}</Text><Text style={styles.muted}>{order ? "يمكنك متابعة التسوق من كتالوج المتجر." : "اختر منتجات من كتالوج المتجر ثم عد إلى السلة لإتمام الطلب."}</Text><Link href={`/store/${encodeURIComponent(storeId)}` as Href} asChild><BthwaniButton label="العودة إلى كتالوج المتجر" variant="secondary" /></Link></BthwaniSurface> : null}
      {state.kind === "ready" ? <>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showItems }} style={styles.itemsToggle} onPress={() => setShowItems((value) => !value)}>
          <Text style={styles.lineTitle}>محتويات الطلب ({state.cart.lines.length})</Text>
          <Text style={styles.toggleLabel}>{showItems ? "إخفاء −" : "عرض وتعديل +"}</Text>
        </Pressable>
        {showItems ? <View style={styles.lineList}>{state.cart.lines.map((line) => {
          const lineBusy = busyLineId === line.id;
          const canDecrease = isQuantityAllowed(line, line.quantityBaseUnits - line.quantityStepBaseUnits);
          const canIncrease = isQuantityAllowed(line, line.quantityBaseUnits + line.quantityStepBaseUnits);
          return <View key={line.id} style={styles.line}>
            <Text style={styles.lineTitle}>{line.productName}</Text>
            {line.variantTitle ? <Text style={styles.muted}>{line.variantTitle}</Text> : null}
            {line.selectedModifiers.length ? <Text style={styles.modifiers}>{line.selectedModifiers.map((modifier) => modifier.optionNameAr).join("، ")}</Text> : null}
            {line.requiresReview ? <Text accessibilityRole="alert" style={styles.warning}>تغيّر توفر هذا المنتج أو الكمية المسموحة أو خياراته. احذفه من السلة واختر منتجًا متاحًا من المتجر؛ لن نعرض سعرًا غير مؤكد.</Text> : null}
            <Text style={styles.muted}>{line.requiresReview ? `الكمية ${formatQuantity(line.baseUnit, line.quantityBaseUnits)} · السعر يحتاج تحديثًا` : `${formatMoney(line.lineAmountMinor, line.currency)} · الكمية ${formatQuantity(line.baseUnit, line.quantityBaseUnits)}`}</Text>
            <View style={styles.lineActions}>
              <BthwaniButton accessibilityLabel={`إنقاص كمية ${line.productName}`} disabled={mutationBusy || line.requiresReview || !canDecrease} label="إنقاص" onPress={() => void updateLine(line, -1)} variant="secondary" />
              <BthwaniButton accessibilityLabel={`زيادة كمية ${line.productName}`} disabled={mutationBusy || line.requiresReview || !canIncrease} label="زيادة" onPress={() => void updateLine(line, 1)} variant="secondary" />
              <BthwaniButton accessibilityLabel={`إزالة ${line.productName} من السلة`} busy={lineBusy} disabled={mutationBusy} label="إزالة" onPress={() => void removeLine(line)} variant="danger" />
            </View>
          </View>;
        })}</View> : null}
        <View accessibilityLabel="ملخص الدفع" style={styles.totals}>
          <Text style={styles.muted}>{cartNeedsReview ? "مجموع المنتجات غير متاح حتى إزالة المنتجات التي تحتاج مراجعة." : `مجموع المنتجات: ${formatMoney(state.cart.lines.reduce((sum, line) => sum + line.lineAmountMinor, 0), state.cart.lines[0]?.currency ?? "YER")}`}</Text>
          <View style={styles.promotionBox}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPromotion }} onPress={() => setShowPromotion((value) => !value)}><Text style={styles.fulfillmentTitle}>{showPromotion ? "قسيمة التخفيض −" : "هل لديك قسيمة تخفيض؟  إضافة +"}</Text></Pressable>
            {initialPromotionCode ? <Text style={styles.muted}>رمز العرض جاهز من المتجر. اضغط «تطبيق» ليتحقق النظام من الأهلية.</Text> : null}
            {showPromotion ? <View style={styles.promotionRow}><TextInput accessibilityLabel="رمز العرض" autoCapitalize="characters" editable={!mutationBusy} onChangeText={setPromotionCode} placeholder="رمز القسيمة" placeholderTextColor={theme.colorMuted} style={styles.promotionInput} value={promotionCode} /><BthwaniButton disabled={mutationBusy || (!pickupMode && !serviceableAddressId)} label="تطبيق" onPress={() => { if (promotionNeedsApply) setAppliedPromotionCode(promotionCode.trim().toUpperCase()); else if (readyCart) void refreshQuote(readyCart); }} variant="secondary" /></View> : null}
          </View>
          {verifiedQuote ? <>
            {verifiedQuote.discountMinor > 0 ? <Text style={styles.success}>الخصم: -{formatMoney(verifiedQuote.discountMinor, verifiedQuote.currency)}{verifiedQuote.promotionCode ? ` · ${verifiedQuote.promotionCode}` : ""}</Text> : null}
            {!pickupMode ? <Text style={styles.muted}>رسوم التوصيل: {formatMoney(verifiedQuote.deliveryFeeMinor, verifiedQuote.currency)}</Text> : <Text style={styles.muted}>رسوم التوصيل: لا توجد — الاستلام من المتجر</Text>}
            <Text style={styles.total}>الإجمالي المتوقع عند الإتمام: {formatMoney(verifiedQuote.totalAmountMinor, verifiedQuote.currency)}</Text>
          </> : null}
          {promotionNeedsApply ? <Text accessibilityLiveRegion="polite" style={styles.warning}>اضغط «تطبيق» لتحديث الإجمالي بحسب رمز العرض الحالي.</Text> : quote.kind === "ready" && !verifiedQuote ? <Text accessibilityLiveRegion="polite" style={styles.warning}>تغيّرت تفاصيل الطلب؛ جارٍ تحديث الإجمالي والخصم قبل الإتمام.</Text> : null}
          <View accessibilityLabel="توزيع مصدر الدفع" style={styles.balanceBox}>
            <Text style={styles.fulfillmentTitle}>طريقة الدفع</Text>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: !useWalletBalance }} disabled={mutationBusy} onPress={() => setUseWalletBalance(false)} style={[styles.paymentChoice, !useWalletBalance && styles.paymentChoiceSelected]}><Text style={styles.paymentChoiceTitle}>{!useWalletBalance ? "◉" : "○"}  {pickupMode ? "الدفع نقدًا في المتجر" : "الدفع نقدًا عند الاستلام"}</Text><Text style={styles.muted}>المبلغ المستحق نقدًا عند الاستلام</Text></Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: useWalletBalance, disabled: wallet.kind !== "ready" || wallet.availableMinor <= 0 || mutationBusy }} disabled={mutationBusy || wallet.kind !== "ready" || wallet.availableMinor <= 0} onPress={() => setUseWalletBalance(true)} style={[styles.paymentChoice, useWalletBalance && styles.paymentChoiceSelected]}><Text style={styles.paymentChoiceTitle}>{useWalletBalance ? "◉" : "○"}  الدفع من رصيد بثواني</Text><Text style={styles.muted}>{wallet.kind === "ready" && wallet.availableMinor > 0 ? "يُستخدم الرصيد المتاح؛ ويُدفع الباقي نقدًا إن وجد." : "يُتاح الاختيار عند وجود رصيد كافٍ أو جزئي."}</Text></Pressable>
            {wallet.kind === "loading" ? <Text accessibilityLiveRegion="polite" style={styles.muted}>جارٍ قراءة الرصيد المتاح…</Text> : null}
            {wallet.kind === "ready" ? <Text style={styles.muted}>الرصيد المتاح بعد الحجوزات: {formatMoney(wallet.availableMinor, "YER")}</Text> : null}
            {wallet.kind === "error" ? <View style={styles.lineActions}><Text accessibilityRole="alert" style={styles.warning}>تعذر قراءة الرصيد؛ أعد المحاولة أو اختر الدفع نقدًا.</Text><BthwaniButton label="إعادة قراءة الرصيد" onPress={() => void refreshWallet()} variant="secondary" /></View> : null}
            {balanceNeedsRead && wallet.kind === "loading" ? <Text accessibilityRole="alert" style={styles.warning}>انتظر قراءة الرصيد قبل تحديد مبلغ منه.</Text> : null}
            {balanceNeedsRead && wallet.kind === "error" ? <Text accessibilityRole="alert" style={styles.error}>لا يمكن اعتماد مبلغ من الرصيد حتى تتم قراءته بنجاح.</Text> : null}
            {useWalletBalance && wallet.kind === "ready" && wallet.availableMinor === 0 ? <Text style={styles.muted}>رصيدك المتاح صفر؛ سيبقى الإجمالي نقدًا.</Text> : null}
            {wallet.kind === "ready" && wallet.availableMinor === 0 ? <Link href={"/wallet-cash-in" as Href} asChild><BthwaniButton label="شحن المحفظة" variant="secondary" /></Link> : null}
            {verifiedQuote && selectedBalanceMinor !== null ? <Text style={styles.muted}>من المحفظة: {formatMoney(selectedBalanceMinor, "YER")}</Text> : null}
            {remainingCashMinor !== null ? <Text style={styles.total}>المتبقي نقدًا: {formatMoney(remainingCashMinor, "YER")}</Text> : null}
            {remainingCashMinor !== null && remainingCashMinor > 0 ? <Text style={styles.muted}>يُدفع إلى: {cashCollectionPartyLabel(fulfillmentMode)} عند الاستلام.</Text> : null}
          </View>
          {quote.kind === "loading" ? <Text accessibilityLiveRegion="polite" style={styles.muted}>جارٍ حساب الإجمالي النهائي…</Text> : null}
          {quote.kind === "invalid" ? <Text accessibilityRole="alert" style={styles.warning}>لن يُحتسب إجمالي الطلب حتى تزيل المنتجات التي تغير توفرها أو كميتها المسموحة أو خياراتها.</Text> : null}
          {quote.kind === "error" ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{quote.message}</Text> : null}
          {quote.kind === "idle" && !pickupMode && !serviceableAddressId ? <Text style={styles.warning}>اختر عنوانًا مؤهلًا لعرض رسوم التوصيل والإجمالي النهائي.</Text> : null}
          {quote.kind === "error" ? <BthwaniButton label="إعادة حساب الإجمالي" onPress={() => { if (readyCart) void refreshQuote(readyCart); }} variant="secondary" /> : null}
        </View>
        <View accessibilityLabel={pickupMode ? "الاستلام الذاتي من المتجر" : "طريقة التوصيل"} style={styles.fulfillmentCard}>
          <Text style={styles.fulfillmentTitle}>تنفيذ الطلب · الآن</Text>
          <Text style={styles.fulfillmentChoice}>{fulfillmentModeLabel(fulfillmentMode)}</Text>
          <Text style={styles.muted}>{checkoutFulfillmentInstructions[fulfillmentMode]}</Text>
        </View>
        <DeliveryRecipientForm allowOther={!pickupMode} onChange={setRecipient} value={recipient} />
        <Text style={styles.payment}>{remainingCashMinor === 0 ? "الطلب مغطى من المحفظة" : remainingCashMinor !== null ? paymentMethodLabel(paymentMethod, fulfillmentMode, remainingCashMinor) : "سيظهر مبلغ الدفع بعد حساب الإجمالي"}</Text>
        {!pickupMode && serviceableAddressId && selectedAddress ? <Text style={styles.success}>العنوان مؤهل: {selectedAddress.addressText}</Text> : null}
        {!onFooterChange ? <BthwaniButton accessibilityLabel={pickupMode ? "تأكيد طلب الاستلام الذاتي من المتجر" : "تأكيد الطلب"} busy={busy} disabled={mutationBusy || (!pickupMode && !serviceableAddressId) || !verifiedQuote || selectedBalanceMinor === null || balanceNeedsRead || promotionNeedsApply} label={verifiedQuote ? `تأكيد الطلب · ${formatMoney(verifiedQuote.totalAmountMinor, verifiedQuote.currency)}` : "تأكيد الطلب"} onPress={() => void checkout()} /> : null}
      </> : null}
      {order ? <View style={styles.orderBox}><Text style={styles.success}>تم إنشاء الطلب</Text><Text style={styles.muted}>الحالة: {orderStateLabel(order.state)} · الإجمالي: {formatMoney(order.totalAmountMinor, order.currency)}</Text><Text style={styles.payment}>{orderPaymentDisclosure(order).amount}</Text><Text style={styles.muted}>{orderPaymentDisclosure(order).status}</Text><Link href={`/orders/${encodeURIComponent(order.id)}` as Href} asChild><BthwaniButton label="فتح تفاصيل الطلب" variant="secondary" /></Link></View> : null}
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: premium.background, gap: spacing[3], marginTop: spacing[1], paddingBottom: spacing[3] },
    title: { ...typography.titleSm, color: premium.text },
    muted: { ...typography.bodySm, color: premium.muted, lineHeight: 19 },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    emptyState: { alignItems: "stretch", backgroundColor: premium.surface, borderRadius: radius.sm, gap: spacing[2], padding: spacing[3] },
    lineList: { gap: spacing[2] },
    itemsToggle: { backgroundColor: premium.surface, borderColor: premium.stroke, borderWidth: borders.hairline, borderRadius: radius.lg, padding: spacing[3], minHeight: 54, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
    toggleLabel: { ...typography.bodySm, color: premium.orange },
    line: { borderColor: premium.stroke, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    lineTitle: { ...typography.bodyStrong, color: premium.text },
    modifiers: { ...typography.bodySm, color: premium.orange },
    lineActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[2] },
    fulfillmentCard: { backgroundColor: premium.soft, borderColor: premium.orange, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    fulfillmentTitle: { ...typography.label, color: premium.orange },
    fulfillmentChoice: { ...typography.bodyStrong, color: premium.text },
    total: { ...typography.bodyStrong, color: premium.text },
    totals: { backgroundColor: premium.surface, borderColor: premium.stroke, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    balanceBox: { backgroundColor: premium.surface, borderColor: premium.stroke, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    paymentChoice: { backgroundColor: premium.raised, borderColor: premium.stroke, borderRadius: radius.md, borderWidth: borders.hairline, padding: spacing[3], minHeight: 64, gap: spacing[1] },
    paymentChoiceSelected: { borderColor: premium.orange, backgroundColor: premium.soft },
    paymentChoiceTitle: { ...typography.bodyStrong, color: premium.text },
    payment: { ...typography.bodySm, color: premium.orange, lineHeight: 19 },
    orderBox: { backgroundColor: premium.soft, borderRadius: radius.sm, gap: spacing[1], padding: spacing[3] },
    success: { ...typography.bodyStrong, color: theme.success },
    warning: { ...typography.bodyStrong, color: theme.warning },
    error: { ...typography.bodySm, color: theme.danger },
    promotionBox: { borderColor: premium.stroke, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2] },
    promotionRow: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    promotionInput: { ...typography.bodySm, backgroundColor: premium.raised, borderColor: premium.stroke, borderRadius: radius.sm, borderWidth: borders.hairline, color: premium.text, flex: 1, minHeight: 42, paddingHorizontal: spacing[2] },
  });
}
