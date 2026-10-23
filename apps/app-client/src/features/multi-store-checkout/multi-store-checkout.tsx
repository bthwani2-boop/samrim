import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, type ClientOpenCartSummary, type PublicStoreView, type CheckoutQuote, type CustomerFulfillmentMode, type DeliveryAddress, formatMoney, fulfillmentModeLabel, type MultiStoreCheckout, type MultiStoreCheckoutRequest } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { createDshMobileClient } from "@bthwani/dsh";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "../../bootstrap/compatible-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PremiumFulfillmentSelector, PremiumOutlineAction, PremiumStickyFooter, PremiumStoreIdentity, premiumColors } from "../order-experience/premium-order-ui";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { isClientActorScopeCurrent } from "../orders/order-session-scope";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { createMultiStoreCheckout, listOwnDeliveryAddresses, listOwnOpenCarts, quoteMultiStoreChildCheckout, readOwnMultiStoreCheckout, readPublishedStore } from "../store-discovery/store-discovery-client";
import { checkoutRecipient, DeliveryRecipientForm, deliveryRecipientIsValid, type DeliveryRecipientInput } from "../cart-checkout/delivery-recipient-form";
import { readSavedFulfillmentMode, resolveFulfillmentChoice, saveFulfillmentMode } from "../cart-checkout/fulfillment-choice";
import { acknowledgedDiscoveryClickForCheckout } from "../store-discovery/discovery-analytics";

async function readCartForPreview(token: string, storeID: string) {
  const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!url) throw new Error("DSH_BASE_URL_REQUIRED");
  return (await createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() }).readOpenCart(token, storeID)).cart;
}
type StoreCart = Readonly<{ store: ClientOpenCartSummary; cart: Readonly<{ id: string; version: number; lineCount: number }>; identity: PublicStoreView | null; subtotalMinor: number | null }>;
type PendingMultiStoreAttempt =
  | Readonly<{ version: 3 | 4; kind: "CREATE"; actorID: string; idempotencyKey: string; correlationID: string; request: MultiStoreCheckoutRequest }>
  | Readonly<{ version: 2; kind: "LEGACY_CREATE"; actorID: string; idempotencyKey: string; correlationID: string; checkoutID: string }>;
type CompactCheckoutChild = readonly [cartID: string, storeID: string, addressID: string, cartVersion: number, fulfillmentMode: CustomerFulfillmentMode, expectedTotalAmountMinor: number, recipient: DeliveryRecipientInput];
type CompactCheckoutRequest = readonly [id: string, children: ReadonlyArray<CompactCheckoutChild>, discoveryClickEventId?: string];
type ScreenState =
  | { kind: "loading" }
  | { kind: "ready"; storeCarts: ReadonlyArray<StoreCart>; otherCityCartCount: number; selectedStoreIDs: ReadonlyArray<string>; addresses: ReadonlyArray<DeliveryAddress>; selectedAddressID: string; fulfillmentModes: Readonly<Record<string, CustomerFulfillmentMode | null>>; checkout?: MultiStoreCheckout }
  | { kind: "single"; storeCart: StoreCart; otherCityCartCount: number }
  | { kind: "empty"; otherCityCartCount: number }
  | { kind: "error" };

const pendingMultiStoreAttemptPrefix = "bthwani.client.multi-store-checkout.pending.v1";

async function authenticatedClientActorID(): Promise<string> {
  await getUsableIdentityAccessToken();
  const session = currentIdentityState();
  if (session.kind !== "authenticated" || !session.identity.subject.trim()) throw new Error("CLIENT_SESSION_REQUIRED");
  return session.identity.subject.trim();
}

function hasCurrentMultiStoreActor(actorID: string): boolean {
  const session = currentIdentityState();
  return session.kind === "authenticated" && isClientActorScopeCurrent(actorID, session.identity.subject.trim());
}

function pendingMultiStoreAttemptKey(actorID: string): string {
  return `${pendingMultiStoreAttemptPrefix}.${encodeURIComponent(actorID)}`;
}

function isCheckoutFulfillmentMode(value: unknown): value is CustomerFulfillmentMode {
  return value === "BTHWANI_CAPTAIN" || value === "PARTNER_CAPTAIN" || value === "CUSTOMER_PICKUP";
}

type MultiStoreCheckoutChildRequest = MultiStoreCheckoutRequest["children"][number];

type ConfirmedMultiStoreQuotePreview = Readonly<{
  fingerprint: string;
  children: ReadonlyArray<Readonly<{ storeName: string; quote: CheckoutQuote }>>;
  totalAmountMinor: number;
}>;

function parseCheckoutChild(value: unknown, compact: boolean): MultiStoreCheckoutChildRequest | null {
  let fields: ReadonlyArray<unknown>;
  let rawRecipient: unknown;
  if (compact) {
    if (!Array.isArray(value) || value.length !== 7) return null;
    fields = value.slice(0, 6);
    rawRecipient = value[6];
  } else {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const child = value as Record<string, unknown>;
    fields = [child.cartId, child.storeId, child.addressId, child.cartVersion, child.fulfillmentMode, child.expectedTotalAmountMinor];
    rawRecipient = child.recipient;
  }
  const [cartId, storeId, addressId, cartVersion, fulfillmentMode, expectedTotalAmountMinor] = fields;
  if (typeof cartId !== "string" || !cartId || cartId.length > 128 || typeof storeId !== "string" || !storeId || storeId.length > 128 || typeof addressId !== "string" || addressId.length > 128 || !Number.isSafeInteger(cartVersion) || Number(cartVersion) < 1 || !isCheckoutFulfillmentMode(fulfillmentMode) || !Number.isSafeInteger(expectedTotalAmountMinor) || Number(expectedTotalAmountMinor) <= 0) return null;
  const recipient = parseDeliveryRecipient(rawRecipient);
  if (!recipient) return null;
  return { cartId, storeId, addressId, cartVersion: Number(cartVersion), fulfillmentMode, expectedTotalAmountMinor: Number(expectedTotalAmountMinor), recipient };
}

function parseDeliveryRecipient(value: unknown): DeliveryRecipientInput | null {
  if (value === undefined) return { mode: "SELF" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const recipient = value as Record<string, unknown>;
  if (recipient.mode === "SELF") return { mode: "SELF" };
  if (recipient.mode !== "OTHER" || (recipient.name !== undefined && typeof recipient.name !== "string") || (recipient.phoneE164 !== undefined && typeof recipient.phoneE164 !== "string") || (recipient.instructions !== undefined && typeof recipient.instructions !== "string")) return null;
  const name = recipient.name as string | undefined;
  const phoneE164 = recipient.phoneE164 as string | undefined;
  const instructions = recipient.instructions as string | undefined;
  if ((name?.length ?? 0) > 120 || (phoneE164?.length ?? 0) > 16 || (instructions?.length ?? 0) > 500) return null;
  return { mode: "OTHER", ...(name !== undefined ? { name } : {}), ...(phoneE164 !== undefined ? { phoneE164 } : {}), ...(instructions !== undefined ? { instructions } : {}) };
}

function parseCheckoutRequest(value: unknown, compact: boolean): MultiStoreCheckoutRequest | null {
  let id: unknown;
  let rawChildren: unknown;
  if (compact && Array.isArray(value) && (value.length === 2 || value.length === 3)) {
    [id, rawChildren] = value;
  } else if (!compact && value && typeof value === "object" && !Array.isArray(value)) {
    const request = value as Record<string, unknown>;
    id = request.id;
    rawChildren = request.children;
  } else {
    return null;
  }
  if (typeof id !== "string" || id.length === 0 || id.length > 128 || !Array.isArray(rawChildren) || rawChildren.length < 2 || rawChildren.length > 10) return null;
  const children = rawChildren.map((child) => parseCheckoutChild(child, compact));
  if (children.some((child) => child === null)) return null;
  const discoveryClickEventId = compact ? (value as unknown[])[2] : (value as Record<string, unknown>).discoveryClickEventId;
  if (discoveryClickEventId !== undefined && (typeof discoveryClickEventId !== "string" || discoveryClickEventId.length > 128)) return null;
  return { id, children: children as MultiStoreCheckoutRequest["children"], ...(discoveryClickEventId ? { discoveryClickEventId } : {}) };
}

function parsePendingMultiStoreAttempt(raw: string | null, actorID: string): PendingMultiStoreAttempt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const version = value.version;
    if ((version !== 1 && version !== 2 && version !== 3 && version !== 4) || value.actorID !== actorID || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 8 || value.idempotencyKey.length > 128 || typeof value.correlationID !== "string" || value.correlationID.length < 8 || value.correlationID.length > 128) return null;
    const common = { version: (version === 3 ? 3 : 4) as 3 | 4, actorID, idempotencyKey: value.idempotencyKey, correlationID: value.correlationID };
    if (value.kind === "CREATE") {
      if (version !== 3 && version !== 4) {
        // Historical v1/v2 CREATE attempts lack consented child amounts.
        // Read their canonical parent by ID, but NEVER submit them again.
        const raw = value.request;
        const checkoutID = version === 2 && Array.isArray(raw) ? raw[0] : raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).id : null;
        return typeof checkoutID === "string" && checkoutID.length > 0 && checkoutID.length <= 128
          ? { version: 2, kind: "LEGACY_CREATE", actorID, idempotencyKey: value.idempotencyKey, correlationID: value.correlationID, checkoutID }
          : null;
      }
      const request = parseCheckoutRequest(value.request, true);
      return request ? { ...common, kind: "CREATE", request } : null;
    }
    // A saved cancellation from an earlier app version is READ ONLY. Never retry it.
    if (value.kind === "CANCEL" && typeof value.checkoutID === "string" && value.checkoutID.length > 0 && value.checkoutID.length <= 128) {
      return { version: 2, kind: "LEGACY_CREATE", actorID, idempotencyKey: value.idempotencyKey, correlationID: value.correlationID, checkoutID: value.checkoutID };
    }
    return null;
  } catch {
    return null;
  }
}

function serializePendingMultiStoreAttempt(attempt: PendingMultiStoreAttempt): string {
  if (attempt.kind === "LEGACY_CREATE") return JSON.stringify(attempt);
  const children: ReadonlyArray<CompactCheckoutChild> = attempt.request.children.map((child): CompactCheckoutChild =>
    [child.cartId, child.storeId, child.addressId, child.cartVersion, child.fulfillmentMode, child.expectedTotalAmountMinor, child.recipient ?? { mode: "SELF" }]);
  const request: CompactCheckoutRequest = attempt.request.discoveryClickEventId
    ? [attempt.request.id, children, attempt.request.discoveryClickEventId]
    : [attempt.request.id, children];
  return JSON.stringify({ ...attempt, request });
}

function isDshHttpStatus(error: unknown, status: number): boolean {
  return Boolean(error && typeof error === "object" && (error as { kind?: unknown }).kind === "http" && (error as { status?: unknown }).status === status);
}

type PendingMultiStoreOutcome = Readonly<{ checkout?: MultiStoreCheckout; terminal: boolean; attempt?: PendingMultiStoreAttempt; error?: unknown }>;

function isTerminalMultiStoreCheckout(checkout: MultiStoreCheckout): boolean {
  return checkout.state === "COMPLETE" || checkout.state === "FAILED" || checkout.state === "PARTIAL_FAILURE" || checkout.state === "CANCELLED";
}

async function resolvePendingMultiStoreAttempt(attempt: PendingMultiStoreAttempt): Promise<PendingMultiStoreOutcome> {
  if (attempt.kind === "LEGACY_CREATE") {
    try {
      const checkout = (await readOwnMultiStoreCheckout(attempt.checkoutID)).checkout;
      return { checkout, terminal: isTerminalMultiStoreCheckout(checkout) };
    } catch (error) {
      // Keep the historical receipt for future canonical reconciliation;
      // never resubmit an unconsented child amount.
      return { terminal: false, error };
    }
  }
  let checkout: MultiStoreCheckout | undefined;
  try {
    checkout = (await readOwnMultiStoreCheckout(attempt.request.id)).checkout;
    if (isTerminalMultiStoreCheckout(checkout)) return { checkout, terminal: true };
  } catch (error) {
    if (!isDshHttpStatus(error, 404)) return { terminal: false, error };
  }

  try {
    checkout = (await createMultiStoreCheckout(attempt.request, attempt.idempotencyKey, attempt.correlationID)).checkout;
    return { checkout, terminal: isTerminalMultiStoreCheckout(checkout) };
  } catch (error) {
    try {
      checkout = (await readOwnMultiStoreCheckout(attempt.request.id)).checkout;
      return { checkout, terminal: isTerminalMultiStoreCheckout(checkout), error };
    } catch {
      return { terminal: false, error };
    }
  }
}

export default function MultiStoreCheckoutScreen() {
  const router = useRouter();
  const { selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const premium = premiumColors(theme);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [pendingAttempt, setPendingAttempt] = useState<PendingMultiStoreAttempt | null>(null);
  const [quotePreview, setQuotePreview] = useState<ConfirmedMultiStoreQuotePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recipient, setRecipient] = useState<DeliveryRecipientInput>({ mode: "SELF" });
  const [addressesExpanded, setAddressesExpanded] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
  const [expandedModeStoreID, setExpandedModeStoreID] = useState<string | null>(null);
  const loadRequestID = useRef(0);
  const hasFocused = useRef(false);
  const submitInFlight = useRef(false);
  const activeActorRef = useRef((() => {
    const session = currentIdentityState();
    return session.kind === "authenticated" ? session.identity.subject.trim() : "";
  })());

  const load = useCallback(async () => {
    const requestID = ++loadRequestID.current;
    if (!selectedCityID) {
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    setQuotePreview(null);
    setError("");
    try {
      const actorID = await authenticatedClientActorID();
      const isCurrent = () => requestID === loadRequestID.current && hasCurrentMultiStoreActor(actorID);
      if (!isCurrent()) return;
      const storageKey = pendingMultiStoreAttemptKey(actorID);
      const rawAttempt = await SecureStore.getItemAsync(storageKey);
      if (!isCurrent()) return;
      const attempt = rawAttempt ? parsePendingMultiStoreAttempt(rawAttempt, actorID) : null;
      if (rawAttempt && !attempt) throw new Error("PENDING_MULTI_STORE_CHECKOUT_INVALID");
      const [cartResponse, addressResponse] = await Promise.all([listOwnOpenCarts(), listOwnDeliveryAddresses()]);
      if (!isCurrent()) return;
      const currentCityCarts = cartResponse.carts.filter((cart) => cart.serviceCityId === selectedCityID);
      const otherCityCartCount = cartResponse.carts.length - currentCityCarts.length;
      const token = await getUsableIdentityAccessToken();
      const storeCarts: ReadonlyArray<StoreCart> = await Promise.all(currentCityCarts.map(async (store) => {
        const [identityResult, cartResult] = await Promise.allSettled([
          readPublishedStore(store.storeId, selectedCityID), readCartForPreview(token, store.storeId),
        ]);
        const identity = identityResult.status === "fulfilled" ? identityResult.value : null;
        const cart = cartResult.status === "fulfilled" ? cartResult.value : null;
        const subtotalMinor = cart && cart.version === store.cartVersion && cart.lines.length === store.lineCount && cart.lines.every((line) => !line.requiresReview)
          ? cart.lines.reduce((sum, line) => sum + line.lineAmountMinor, 0) : null;
        return { store, cart: { id: store.cartId, version: store.cartVersion, lineCount: store.lineCount }, identity, subtotalMinor };
      }));
      if (!isCurrent()) return;
      let checkout: MultiStoreCheckout | undefined;
      let unresolvedAttempt = attempt;
      let attemptError = "";
      if (attempt) {
        if (!isCurrent()) return;
        const outcome = await resolvePendingMultiStoreAttempt(attempt);
        checkout = outcome.checkout;
        if (outcome.attempt) unresolvedAttempt = outcome.attempt;
        if (outcome.error) attemptError = "تعذر تأكيد نتيجة الطلب السابق. ستبقى المحاولة محفوظة؛ تحقق من حالتها لإكمال الاستعادة بأمان.";
        if (outcome.terminal) {
          if (!isCurrent()) return;
          await SecureStore.deleteItemAsync(storageKey);
          unresolvedAttempt = null;
        }
      }
      if (!isCurrent()) return;
      if (attemptError) setError(attemptError);
      setPendingAttempt(unresolvedAttempt);
      if (storeCarts.length === 0 && !unresolvedAttempt && !checkout) {
        setState({ kind: "empty", otherCityCartCount });
        return;
      }
      const [singleStoreCart] = storeCarts;
      if (singleStoreCart && storeCarts.length === 1 && !unresolvedAttempt && !checkout) {
        setState({ kind: "single", storeCart: singleStoreCart, otherCityCartCount });
        return;
      }
      const preferences = await Promise.all(storeCarts.map(async ({ store }) => {
        const available = availableCustomerFulfillmentModes(store.fulfillmentModes);
        const saved = await readSavedFulfillmentMode(store.storeId, selectedCityID, available);
        return [store.storeId, resolveFulfillmentChoice(available, null, saved)] as const;
      }));
      if (!isCurrent()) return;
      const fulfillmentModes = Object.fromEntries(preferences);
      // Having several saved baskets is NOT consent to purchase from several stores.
      const selectedStoreIDs: string[] = [];
      setMultiMode(false);
      setState({ kind: "ready", storeCarts, otherCityCartCount, selectedStoreIDs, addresses: addressResponse.addresses, selectedAddressID: addressResponse.addresses[0]?.id ?? "", fulfillmentModes, ...(checkout ? { checkout } : {}) });
    } catch {
      if (requestID === loadRequestID.current) setState({ kind: "error" });
    }
  }, [selectedCityID]);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeIdentitySession((session) => {
      const nextActorID = session.kind === "authenticated" ? session.identity.subject.trim() : "";
      if (nextActorID === activeActorRef.current) return;
      activeActorRef.current = nextActorID;
      loadRequestID.current += 1;
      setState({ kind: "loading" });
      setPendingAttempt(null);
      setQuotePreview(null);
      setError("");
      if (nextActorID) void load();
      else setState({ kind: "error" });
    });
    return () => { loadRequestID.current += 1; unsubscribe(); };
  }, [load]);

  useEffect(() => {
    if (state.kind === "single") {
      router.replace(("/cart/" + encodeURIComponent(state.storeCart.store.storeId)) as Href);
    }
  }, [router, state]);

  async function submit() {
    if (submitInFlight.current || busy || pendingAttempt || state.kind !== "ready" || state.checkout || state.selectedStoreIDs.length < 2 || state.selectedStoreIDs.length > 10) return;
    const selectedStoreCarts = state.storeCarts.flatMap(({ store, cart }) => {
      if (!state.selectedStoreIDs.includes(store.storeId)) return [];
      const fulfillmentMode = selectedFulfillmentMode(store, state.fulfillmentModes);
      return store.publicationState === "published" && fulfillmentMode ? [{ store, cart, fulfillmentMode }] : [];
    });
    if (selectedStoreCarts.length !== state.selectedStoreIDs.length) return;
    const requiresDeliveryAddress = selectedStoreCarts.some(({ fulfillmentMode }) => fulfillmentMode !== "CUSTOMER_PICKUP");
    if (requiresDeliveryAddress && !state.selectedAddressID) return;
    if (requiresDeliveryAddress && !deliveryRecipientIsValid(recipient)) {
      setError("أدخل اسمًا ورقمًا يمنيًا صحيحًا للمستلم، محليًا أو دوليًا، قبل تأكيد الطلب.");
      return;
    }
    submitInFlight.current = true;
    setBusy(true);
    setError("");
    let attemptPersisted = false;
    try {
      const actorID = await authenticatedClientActorID();
      if (!hasCurrentMultiStoreActor(actorID)) return;
      const fingerprint = JSON.stringify({
        actorID,
        stores: selectedStoreCarts.map(({ store, cart, fulfillmentMode }) => [store.storeId, cart.id, cart.version, fulfillmentMode, fulfillmentMode === "CUSTOMER_PICKUP" ? "" : state.selectedAddressID]),
        recipient,
      });
      if (!quotePreview || quotePreview.fingerprint !== fingerprint) {
        const quotes = await Promise.all(selectedStoreCarts.map(async ({ store, cart, fulfillmentMode }) => {
          const addressId = fulfillmentMode === "CUSTOMER_PICKUP" ? "" : state.selectedAddressID;
          const response = await quoteMultiStoreChildCheckout({ cartId: cart.id, storeId: store.storeId, addressId, fulfillmentMode }, cart.version);
          const quote = response.quote;
          if (quote.cartId !== cart.id || quote.storeId !== store.storeId || quote.addressId !== addressId || quote.fulfillmentMode !== fulfillmentMode || quote.cartVersion !== cart.version || quote.currency !== "YER" || !Number.isSafeInteger(quote.totalAmountMinor) || quote.totalAmountMinor <= 0) {
            throw new Error("INVALID_MULTI_STORE_QUOTE");
          }
          return { storeName: store.storeName, quote };
        }));
        if (!hasCurrentMultiStoreActor(actorID)) return;
        const totalAmountMinor = quotes.reduce((sum, item) => sum + item.quote.totalAmountMinor, 0);
        if (!Number.isSafeInteger(totalAmountMinor)) throw new Error("INVALID_MULTI_STORE_TOTAL");
        // First action only displays the amount. No order or payment is created
        // before the customer confirms this complete cross-store quote.
        setQuotePreview({ fingerprint, children: quotes, totalAmountMinor });
        return;
      }
      const discoveryClickEventId = await acknowledgedDiscoveryClickForCheckout();
      const request: MultiStoreCheckoutRequest = {
        ...(discoveryClickEventId ? { discoveryClickEventId } : {}),
        id: `multi_${Crypto.randomUUID()}`,
        children: selectedStoreCarts.map(({ store, cart, fulfillmentMode }, index) => {
          const accepted = quotePreview.children[index]?.quote;
          const addressId = fulfillmentMode === "CUSTOMER_PICKUP" ? "" : state.selectedAddressID;
          if (!accepted || accepted.cartId !== cart.id || accepted.storeId !== store.storeId || accepted.addressId !== addressId || accepted.cartVersion !== cart.version || accepted.fulfillmentMode !== fulfillmentMode || !Number.isSafeInteger(accepted.totalAmountMinor) || accepted.totalAmountMinor <= 0) {
            throw new Error("STALE_MULTI_STORE_ACCEPTED_QUOTE");
          }
          return { cartId: cart.id, storeId: store.storeId, addressId, cartVersion: cart.version, fulfillmentMode, expectedTotalAmountMinor: accepted.totalAmountMinor, recipient: checkoutRecipient(recipient, fulfillmentMode !== "CUSTOMER_PICKUP") };
        }),
      };
      setQuotePreview(null);
      const attempt: PendingMultiStoreAttempt = {
        version: 4, kind: "CREATE", actorID, idempotencyKey: `multi_idem_${Crypto.randomUUID()}`, correlationID: `multi_corr_${Crypto.randomUUID()}`,
        request,
      };
      if (!hasCurrentMultiStoreActor(actorID)) return;
      await SecureStore.setItemAsync(pendingMultiStoreAttemptKey(actorID), serializePendingMultiStoreAttempt(attempt));
      attemptPersisted = true;
      if (!hasCurrentMultiStoreActor(actorID)) return;
      setPendingAttempt(attempt);
      let checkout: MultiStoreCheckout;
      try {
        checkout = (await createMultiStoreCheckout(request, attempt.idempotencyKey, attempt.correlationID)).checkout;
      } catch {
        const outcome = await resolvePendingMultiStoreAttempt(attempt);
        if (!outcome.checkout) throw outcome.error ?? new Error("CHECKOUT_OUTCOME_UNKNOWN");
        checkout = outcome.checkout;
      }
      if (!hasCurrentMultiStoreActor(actorID)) return;
      if (isTerminalMultiStoreCheckout(checkout)) {
        await SecureStore.deleteItemAsync(pendingMultiStoreAttemptKey(actorID));
        setPendingAttempt(null);
      }
      setState((current) => current.kind === "ready" ? { ...current, checkout } : current);
    } catch {
      setError(attemptPersisted ? "تعذر تأكيد نتيجة المحاولة المحفوظة. لا تبدأ طلبًا جديدًا؛ تحقق من حالتها." : "تعذر حفظ محاولة الطلب محليًا؛ لم يُرسل الطلب. حاول مرة أخرى لاحقًا.");
    } finally {
      submitInFlight.current = false;
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <View style={styles.state} accessibilityLabel="جارٍ تجهيز طلب المتاجر"><BthwaniSkeleton width="50%" height={26} /><BthwaniSkeleton height={92} /><BthwaniSkeleton height={120} /></View>;
  if (state.kind === "error") return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" style={styles.title}>تعذر تجهيز الطلب المتعدد</Text><Text style={styles.muted}>تحقق من مدينة الخدمة والاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /></View>;
  if (state.kind === "empty") return <View style={styles.state}><BthwaniIcon name="cart" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>{state.otherCityCartCount > 0 ? "سلالك في مدينة خدمة أخرى" : "سلة التسوق فارغة"}</Text><Text style={styles.muted}>{state.otherCityCartCount > 0 ? "غيّر مدينة الخدمة لعرض السلال المحفوظة هناك." : "أضف منتجات من المتاجر لتظهر سلالك هنا."}</Text><BthwaniButton label="استكشف المتاجر" onPress={() => router.push("/home" as Href)} /></View>;
  if (state.kind === "single") return <View style={styles.state} accessibilityLabel="سلة متجر"><BthwaniIcon name="cart" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>لديك سلة من {state.storeCart.store.storeName}</Text><Text style={styles.muted}>{state.storeCart.cart.lineCount} منتجات جاهزة للمراجعة.</Text>{state.otherCityCartCount > 0 ? <Text style={styles.muted}>لديك أيضًا سلال محفوظة في مدينة خدمة أخرى.</Text> : null}<BthwaniButton label="فتح سلة المتجر" onPress={() => router.push(`/cart/${encodeURIComponent(state.storeCart.store.storeId)}` as Href)} /></View>;

  const checkout = state.checkout;

  if (pendingAttempt) return <View style={styles.container} accessibilityLabel="استعادة الطلب المتعدد"><BthwaniSurface tone="raised" style={styles.hero}><View style={styles.heroIcon}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconXl} /></View><View style={styles.heroCopy}><Text style={styles.eyebrow}>استعادة الطلب</Text><Text style={styles.title}>نتحقق من النتيجة المحفوظة</Text><Text style={styles.muted}>لن نرسل طلبًا جديدًا. نقرأ النتيجة أولًا ثم نتابع الطلب نفسه.</Text></View></BthwaniSurface>{checkout ? <CheckoutSummary checkout={checkout} styles={styles} theme={theme} /> : <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.cardTitle}>النتيجة لم تُحسم بعد</Text><Text style={styles.muted}>المحاولة محفوظة على هذا الجهاز لهذا الحساب. أعد التحقق عند عودة الاتصال.</Text></BthwaniSurface>}<BthwaniButton busy={busy} disabled={busy} label="تحقق وأكمل الاستعادة" onPress={() => void load()} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</View>;
  if (checkout && state.storeCarts.length === 0) return <View style={styles.container} accessibilityLabel="نتيجة طلب المتاجر"><CheckoutSummary checkout={checkout} styles={styles} theme={theme} /><Text style={styles.muted}>يمكنك إلغاء الطلب التابع المؤهل من تفاصيله قبل قبول متجره؛ بخلاف ذلك تواصل مع العمليات.</Text></View>;
  const selectedStoreCarts = state.storeCarts.filter(({ store }) => state.selectedStoreIDs.includes(store.storeId));
  const hasUnsupportedStore = selectedStoreCarts.some(({ store }) => store.publicationState !== "published" || availableCustomerFulfillmentModes(store.fulfillmentModes).length === 0);
  const requiresDeliveryAddress = selectedStoreCarts.some(({ store }) => { const mode = state.fulfillmentModes[store.storeId]; return mode !== null && mode !== "CUSTOMER_PICKUP"; });
  const invalidRecipient = requiresDeliveryAddress && !deliveryRecipientIsValid(recipient);
  const canSubmitCheckout = !pendingAttempt && state.selectedStoreIDs.length >= 2 && state.selectedStoreIDs.length <= 10 && selectedStoreCarts.length === state.selectedStoreIDs.length;

  const chosenAddress = state.addresses.find((address) => address.id === state.selectedAddressID);
  const missingAddress = requiresDeliveryAddress && !chosenAddress;
  let selectedStoresStatusContent = null;
  if (selectedStoreCarts.length >= 2 && hasUnsupportedStore) {
    selectedStoresStatusContent = <Text accessibilityRole="alert" style={styles.error}>أزل المتجر غير المتاح من الطلب.</Text>;
  }
  let checkoutActionContent = null;
  if (checkout) {
    checkoutActionContent = <CheckoutSummary checkout={checkout} styles={styles} theme={theme} />;
  } else if (selectedStoreCarts.length >= 2) {
    checkoutActionContent = <>
      {quotePreview ? <BthwaniSurface tone="inset" style={styles.summary}>
        <Text style={styles.cardTitle}>مراجعة المبالغ قبل تأكيد الطلب</Text>
        {quotePreview.children.map((child) => <Text key={child.quote.storeId} style={styles.muted}>{child.storeName}: {formatMoney(child.quote.totalAmountMinor, child.quote.currency)}</Text>)}
        <Text style={styles.cardTitle}>الإجمالي الموافق عليه: {formatMoney(quotePreview.totalAmountMinor, "YER")}</Text>
      </BthwaniSurface> : null}

    </>;
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.container} accessibilityLabel="سلة متعددة المتاجر">
      <View style={styles.topRow}><Text style={styles.screenTitle}>السلة</Text><Pressable accessibilityRole="button" accessibilityLabel="الرجوع" onPress={() => router.back()} style={styles.backAction}><BthwaniIcon name="back" color={premium.text} size={24} /></Pressable></View>
      {multiMode ? <BthwaniSurface tone="raised" style={styles.hero}><View style={styles.heroIcon}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconXl} /></View><View style={styles.heroCopy}><Text style={styles.title}>طلب متعدد المتاجر</Text><Text style={styles.muted}>ينشئ بثواني طلبًا مستقلًا لكل متجر ويحفظ نتيجة كل واحد بوضوح.</Text></View></BthwaniSurface> : null}
      {state.otherCityCartCount > 0 ? <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.muted}>لديك {state.otherCityCartCount} سلة محفوظة في مدينة خدمة أخرى. غيّر المدينة لعرضها.</Text></BthwaniSurface> : null}
      {multiMode ? <BthwaniSurface tone="raised" style={styles.addressSummary}>
        <View style={styles.addressHeading}>
          <View style={styles.addressCopy}>
            <Text style={styles.addressTitle}>عنوان التوصيل</Text>
            <Text style={styles.muted} numberOfLines={2}>{chosenAddress?.addressText ?? "لا يوجد عنوان محفوظ للتوصيل"}</Text>
          </View>
          <PremiumOutlineAction label={addressesExpanded ? "إغلاق" : chosenAddress ? "تغيير" : "إضافة"}
            onPress={() => state.addresses.length === 0 ? router.push("/addresses" as Href) : setAddressesExpanded((value) => !value)} />
        </View>
        {addressesExpanded ? <View style={styles.list}>
          {state.addresses.map((address) => <Pressable key={address.id} accessibilityRole="button"
            accessibilityState={{ selected: address.id === state.selectedAddressID }}
            onPress={() => { setQuotePreview(null); setAddressesExpanded(false); setState((current) => current.kind === "ready" ? { ...current, selectedAddressID: address.id } : current); }}
            style={[styles.address, address.id === state.selectedAddressID && styles.addressSelected]}>
            <Text style={styles.addressText}>{address.addressText}</Text>
          </Pressable>)}
          <BthwaniButton label="إضافة عنوان آخر" variant="secondary" onPress={() => router.push("/addresses" as Href)} />
        </View> : null}
        {missingAddress ? <Text accessibilityRole="alert" style={styles.error}>اختر عنوان توصيل قبل إتمام هذه الطلبات.</Text> : null}
      </BthwaniSurface> : null}
      <View style={styles.storeSectionHeader}><Text style={styles.storeSectionTitle}>المتاجر في السلة</Text><Text style={styles.muted}>{multiMode ? state.selectedStoreIDs.length + " محددة من " + state.storeCarts.length : state.storeCarts.length + " سلال محفوظة"}</Text></View>
      <View style={styles.list}>{state.storeCarts.map(({ store, cart, identity, subtotalMinor }) => {
        const selectedMode = selectedFulfillmentMode(store, state.fulfillmentModes);
        const availableModes = availableCustomerFulfillmentModes(store.fulfillmentModes);
        const selected = state.selectedStoreIDs.includes(store.storeId);
        const eligible = store.publicationState === "published" && availableModes.length > 0;
        let unavailableStoreMessage = "";
        if (!eligible && store.publicationState !== "published") unavailableStoreMessage = "المتجر غير منشور حاليًا؛ سلتك محفوظة ويمكنك فتحها.";
        else if (!eligible) unavailableStoreMessage = "لا يتوفر لهذا المتجر وضع طلب حاليًا.";

        return <BthwaniSurface key={store.storeId} tone="raised" style={styles.storeCard}>
          <PremiumStoreIdentity title={store.storeName} compact imageUri={identity?.storeCoverImage?.uri ?? identity?.storeProfileImage?.uri}
            subtitle={identity?.addressLine || "متجر ضمن منصة بثواني"}
            rating={identity && identity.ratingCount > 0 ? identity.ratingAverage.toFixed(1) + " (" + identity.ratingCount + ")" : undefined} />
          <Pressable accessibilityRole="button" onPress={() => router.push(("/cart/" + encodeURIComponent(store.storeId)) as Href)} style={styles.storeReview}>
            <Text style={styles.reviewText}>{multiMode ? "مراجعة تفاصيل المتجر" : "متابعة طلب هذا المتجر"}</Text><BthwaniIcon name="back" color={premium.orange} size={sizing.iconSm} />
          </Pressable>
          <View style={styles.storeTotals}>
            <Text style={styles.muted}>{cart.lineCount} {cart.lineCount === 1 ? "منتج" : "منتجات"}</Text>
            <View style={styles.amountMeta}>
              <Text style={styles.muted}>مجموع المنتجات</Text>
              <Text style={styles.storeAmount}>{subtotalMinor === null ? "يُحسب عند المراجعة" : formatMoney(subtotalMinor, "YER")}</Text>
            </View>
          </View>
          {multiMode ? <View style={styles.storeSelectedRow}>
            <Text style={styles.sectionLabel}>طريقة التنفيذ لهذا المتجر</Text>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy || Boolean(checkout) }}
              disabled={busy || Boolean(checkout) || (!selected && (!eligible || state.selectedStoreIDs.length >= 10))}
              style={[styles.storeSelect, selected && styles.storeSelectActive]} onPress={() => {
                setQuotePreview(null); setState((current) => {
                  if (current.kind !== "ready" || current.checkout) return current;
                  const wasSelected = current.selectedStoreIDs.includes(store.storeId);
                  if (!wasSelected && (!eligible || current.selectedStoreIDs.length >= 10)) return current;
                  return { ...current, selectedStoreIDs: wasSelected ? current.selectedStoreIDs.filter((id) => id !== store.storeId) : [...current.selectedStoreIDs, store.storeId] };
                });
              }}><Text style={styles.storeSelectText}>{selected ? "✓ ضمن الطلب" : "اختيار المتجر"}</Text></Pressable>
          </View> : null}
          {!eligible ? <Text accessibilityRole="alert" style={styles.error}>{store.publicationState !== "published" ? "المتجر غير منشور حاليًا؛ السلة محفوظة." : "لا تتوفر طريقة تنفيذ لهذا المتجر."}</Text> : null}
          {multiMode && selected && eligible ? availableModes.length === 1
            ? <Text style={styles.modeSummary}>{fulfillmentModeLabel(availableModes[0]!)}</Text>
            : selectedMode && expandedModeStoreID !== store.storeId
              ? <Pressable accessibilityRole="button" accessibilityLabel={"تغيير طريقة تنفيذ " + store.storeName}
                  style={styles.storeReview} onPress={() => setExpandedModeStoreID(store.storeId)}>
                  <Text style={styles.reviewText}>{fulfillmentModeLabel(selectedMode)} · تغيير</Text>
                </Pressable>
              : <PremiumFulfillmentSelector available={availableModes} selected={selectedMode} disabled={busy || Boolean(checkout)}
                  onSelect={(mode) => {
                    setExpandedModeStoreID(null);
                    setQuotePreview(null);
                    if (selectedCityID) void saveFulfillmentMode(store.storeId, selectedCityID, mode);
                    setState((current) => current.kind === "ready" && !current.checkout
                      ? { ...current, fulfillmentModes: { ...current.fulfillmentModes, [store.storeId]: mode } } : current);
                  }} /> : null}
          {multiMode && selected && eligible && !selectedMode ? <Text accessibilityRole="alert" style={styles.error}>اختر طريقة تنفيذ الطلب لهذا المتجر.</Text> : null}
        </BthwaniSurface>;
      })}</View>
      {!multiMode && !checkout && state.storeCarts.length >= 2 ? <Pressable accessibilityRole="button"
          accessibilityLabel="اختيار عدة متاجر للطلب في وقت واحد"
          style={styles.multiOptIn} onPress={() => { setMultiMode(true); setQuotePreview(null); }}>
          <Text style={styles.optInText}>هل تريد إتمام طلبات من أكثر من متجر؟</Text>
        </Pressable> : null}
      {multiMode && !checkout ? <View style={styles.multiChoice}>
        <Text style={styles.muted}>اختياري: اختر متجرين أو أكثر بنفسك، وستنشأ طلبات مستقلة.</Text>
        <Pressable accessibilityRole="button" onPress={() => {
          setMultiMode(false); setExpandedModeStoreID(null); setQuotePreview(null);
          setState((current) => current.kind === "ready" && !current.checkout ? { ...current, selectedStoreIDs: [] } : current);
        }}><Text style={styles.optInText}>العودة لطلبات المتاجر المنفردة</Text></Pressable>
        {selectedStoreCarts.length === 1 ? <BthwaniButton label="متابعة طلب المتجر المختار" onPress={() => {
          const only = selectedStoreCarts[0]; if (only) router.push(("/cart/" + encodeURIComponent(only.store.storeId)) as Href);
        }} variant="secondary" /> : null}
        {selectedStoreCarts.length < 2 ? <Text style={styles.muted}>اختر متجرين لإظهار المراجعة المالية المشتركة.</Text> : null}
      </View> : null}
      {multiMode && requiresDeliveryAddress ? <DeliveryRecipientForm allowOther onChange={(next) => { setQuotePreview(null); setRecipient(next); }} value={recipient} /> : null}
      {multiMode ? selectedStoresStatusContent : null}
      {(multiMode || checkout) ? checkoutActionContent : null}
      {checkout ? <Text style={styles.muted}>يُقيّم إلغاء كل طلب تابع بشكل مستقل. افتح تفاصيله للإلغاء قبل قبول المتجر إذا سمحت سياسته، وإلا تواصل مع العمليات.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
    {multiMode && !checkout && selectedStoreCarts.length >= 2 ? <PremiumStickyFooter
      amount={quotePreview ? formatMoney(quotePreview.totalAmountMinor, "YER") : selectedStoreCarts.every((item) => item.subtotalMinor !== null) ? formatMoney(selectedStoreCarts.reduce((sum, item) => sum + (item.subtotalMinor ?? 0), 0), "YER") : "قيد المراجعة"}
      detail={quotePreview ? "الإجمالي النهائي المؤكد" : "مجموع المنتجات قبل رسوم التوصيل"}
      label={quotePreview ? "تأكيد الطلبات" : "متابعة التأكيد"}
      busy={busy}
      disabled={busy || !canSubmitCheckout || hasUnsupportedStore || selectedStoreCarts.some(({ store }) => !state.fulfillmentModes[store.storeId]) || (requiresDeliveryAddress && !state.selectedAddressID) || invalidRecipient}
      onPress={() => void submit()} /> : null}
    </SafeAreaView>
  );
}

function selectedFulfillmentMode(store: ClientOpenCartSummary, selected: Readonly<Record<string, CustomerFulfillmentMode | null>>): CustomerFulfillmentMode | null {
  const mode = selected[store.storeId] ?? null;
  return mode && store.fulfillmentModes.includes(mode) ? mode : null;
}

function modeDescription(mode: CustomerFulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "المنصة تتولى التوصيل.";
  if (mode === "PARTNER_CAPTAIN") return "المتجر يختار أحد كباتنه، ولا تُضاف رسوم توصيل.";
  return "تذهب إلى المتجر لاستلام طلبك بنفسك.";
}

function CheckoutSummary({ checkout, styles, theme }: { checkout: MultiStoreCheckout; styles: ReturnType<typeof createStyles>; theme: ReturnType<typeof resolveTheme> }) {
  const router = useRouter();
  let stateLabel = "جارٍ معالجة الطلبات";
  if (checkout.state === "COMPLETE") stateLabel = "اكتملت كل الطلبات";
  else if (checkout.state === "CANCELLED") stateLabel = "أُلغيت الطلبات التابعة";
  else if (checkout.state === "PARTIAL_FAILURE") stateLabel = "اكتمل جزء من الطلبات";
  else if (checkout.state === "FAILED") stateLabel = "تعذر إنشاء الطلبات";

  return <BthwaniSurface tone="raised" style={styles.summary}><Text style={styles.cardTitle}>{stateLabel}</Text><Text style={styles.muted}>{checkout.successfulChildCount} ناجحة · {checkout.failedChildCount} متعثرة من {checkout.childCount}</Text><View style={styles.childList}>{checkout.children.map((child) => <View key={child.id} style={styles.childRow}><View style={styles.childCopy}><Text style={styles.childStore}>{child.storeName}</Text><Text style={styles.childMode}>{fulfillmentModeLabel(child.fulfillmentMode)}</Text>{child.failureCode ? <Text style={styles.childMode}>{checkoutChildFailureLabel(child.failureCode)}</Text> : null}</View><Text style={{ ...styles.childState, color: checkoutChildStateColor(child.state, theme) }}>{checkoutChildStateLabel(child.state)}</Text>
    {child.state === "SUCCEEDED" && child.orderId ? <BthwaniButton label="متابعة الطلب" variant="secondary" onPress={() => router.push(("/orders/" + encodeURIComponent(child.orderId!)) as Href)} /> : null}
  </View>)}</View></BthwaniSurface>;
}

function checkoutChildStateColor(state: MultiStoreCheckout["children"][number]["state"], theme: ReturnType<typeof resolveTheme>) {
  if (state === "SUCCEEDED" || state === "CANCELLED") return theme.success;
  if (state === "FAILED" || state === "CANCEL_FAILED") return theme.danger;
  return theme.warning;
}

function checkoutChildFailureLabel(code: string): string {
  if (code === "PAYMENT_RECONCILED") return "أُلغيت محاولة الدفع السابقة بأمان؛ حدّث السلة ثم أعد الإرسال.";
  if (code === "DELIVERY_FEE_UNAVAILABLE") return "تعذر تأكيد رسوم التوصيل؛ لم يُنشأ هذا الطلب. حدّث السلة وأعد المحاولة لاحقًا.";
  return "راجع السلة والمنتجات الحالية قبل بدء محاولة جديدة.";
}

function checkoutChildStateLabel(state: MultiStoreCheckout["children"][number]["state"]): string {
  switch (state) {
    case "PENDING": return "قيد المعالجة";
    case "SUCCEEDED": return "تم إنشاء الطلب";
    case "FAILED": return "تعذر إنشاء الطلب";
    case "CANCELLED": return "أُلغي الطلب";
    case "CANCEL_FAILED": return "تعذر الإلغاء";
  }
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const premium = premiumColors(theme);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: premium.background },
    container: { gap: spacing[3], paddingHorizontal: spacing[3], paddingBottom: spacing[8], width: "100%" },
    topRow: { flexDirection: "row", alignItems: "center", minHeight: 56 },
    backAction: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
    screenTitle: { ...typography.titleLg, color: premium.text, textAlign: "center", marginVertical: spacing[2], flex: 1 },
    storeReview: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", minHeight: 44, paddingHorizontal: spacing[3], gap: spacing[1], borderColor: premium.stroke, borderWidth: 1, borderRadius: radius.md },
    reviewText: { ...typography.bodySm, color: premium.orange },
    storeTotals: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopColor: premium.stroke, borderTopWidth: 1, paddingTop: spacing[3] },
    amountMeta: { gap: spacing[1], alignItems: "flex-end" },
    storeAmount: { ...typography.titleSm, color: premium.text },
    sectionLabel: { ...typography.bodyStrong, color: premium.orange },
    storeSectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing[2] },
    storeSectionTitle: { ...typography.titleSm, color: premium.text },
    storeSelect: { borderWidth: 1, borderColor: premium.stroke, borderRadius: radius.md, paddingHorizontal: 9, minHeight: 44, justifyContent: "center", alignItems: "center" },
    storeSelectActive: { borderColor: premium.orange, backgroundColor: premium.soft },
    storeSelectText: { ...typography.caption, color: premium.orange },
    addressSummary: { backgroundColor: premium.surface, borderColor: premium.stroke, borderWidth: 1, borderRadius: radius.xl, gap: spacing[3], padding: spacing[3] },
    addressHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing[2] },
    addressCopy: { flex: 1, alignItems: "flex-end", gap: spacing[1] },
    addressTitle: { ...typography.bodyStrong, color: premium.text, textAlign: "right" },
    storeSelectedRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing[2] },
    multiOptIn: { minHeight: 48, borderWidth: 1, borderColor: premium.stroke, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[3] },
    multiChoice: { gap: spacing[2], padding: spacing[3], borderRadius: radius.lg, backgroundColor: premium.surface },
    optInText: { ...typography.bodySm, color: premium.orange, textAlign: "center" },
    modeSummary: { ...typography.bodyStrong, color: premium.text, textAlign: "right" },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    hero: { backgroundColor: premium.soft, borderColor: premium.coral, borderWidth: 1, alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    heroIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    heroCopy: { flex: 1, gap: spacing[1] },
    eyebrow: { ...typography.label, color: premium.orange, textAlign: "right" },
    title: { ...typography.titleMd, color: premium.orange, textAlign: "right" },
    cardTitle: { ...typography.titleSm, color: premium.text, textAlign: "right" },
    muted: { ...typography.bodySm, color: premium.muted, textAlign: "right" },
    list: { gap: spacing[2] },
    storeCard: { backgroundColor: premium.surface, borderColor: premium.stroke, borderWidth: 1, borderRadius: radius.xl, gap: spacing[3], padding: spacing[3] },
    storeIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    storeCopy: { flex: 1, gap: spacing[1] },
    storeModes: { flexBasis: "100%", flexDirection: "row", flexWrap: "wrap", gap: spacing[1] },
    address: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    addressSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    addressText: { ...typography.bodyStrong, color: premium.text, textAlign: "right" },
    summary: { backgroundColor: premium.surface, borderColor: premium.stroke, borderWidth: 1, borderRadius: radius.lg, gap: spacing[2], padding: spacing[4] },
    childList: { gap: spacing[2], marginTop: spacing[2] },
    childRow: { alignItems: "center", borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing[2] },
    childCopy: { flex: 1, gap: spacing[1] },
    childStore: { ...typography.bodySm, color: theme.color },
    childMode: { ...typography.caption, color: theme.colorMuted },
    childState: { ...typography.label },
    error: { ...typography.bodySm, color: theme.danger },
    pressed: { opacity: opacity.subtle },
  });
}
