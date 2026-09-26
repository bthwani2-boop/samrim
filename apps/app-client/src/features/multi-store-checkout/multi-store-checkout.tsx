import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, type ClientOpenCartSummary, type CustomerFulfillmentMode, type DeliveryAddress, fulfillmentModeLabel, type MultiStoreCheckout, type MultiStoreCheckoutRequest } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { cancelMultiStoreCheckout, createMultiStoreCheckout, listOwnDeliveryAddresses, listOwnOpenCarts, readOwnMultiStoreCheckout } from "../store-discovery/store-discovery-client";

type StoreCart = Readonly<{ store: ClientOpenCartSummary; cart: Readonly<{ id: string; version: number; lineCount: number }> }>;
type PendingMultiStoreAttempt =
  | Readonly<{ version: 2; kind: "CREATE"; actorID: string; idempotencyKey: string; correlationID: string; request: MultiStoreCheckoutRequest }>
  | Readonly<{ version: 2; kind: "CANCEL"; actorID: string; idempotencyKey: string; correlationID: string; checkoutID: string; expectedVersion: number }>;
type CompactCheckoutChild = readonly [cartID: string, storeID: string, addressID: string, cartVersion: number, fulfillmentMode: CustomerFulfillmentMode];
type CompactCheckoutRequest = readonly [id: string, children: ReadonlyArray<CompactCheckoutChild>];
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

function pendingMultiStoreAttemptKey(actorID: string): string {
  return `${pendingMultiStoreAttemptPrefix}.${encodeURIComponent(actorID)}`;
}

function isCheckoutFulfillmentMode(value: unknown): value is CustomerFulfillmentMode {
  return value === "BTHWANI_CAPTAIN" || value === "PARTNER_CAPTAIN" || value === "CUSTOMER_PICKUP";
}

type MultiStoreCheckoutChildRequest = MultiStoreCheckoutRequest["children"][number];

function parseCheckoutChild(value: unknown, compact: boolean): MultiStoreCheckoutChildRequest | null {
  let fields: ReadonlyArray<unknown>;
  if (compact) {
    if (!Array.isArray(value) || value.length !== 5) return null;
    fields = value;
  } else {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const child = value as Record<string, unknown>;
    fields = [child.cartId, child.storeId, child.addressId, child.cartVersion, child.fulfillmentMode];
  }
  const [cartId, storeId, addressId, cartVersion, fulfillmentMode] = fields;
  if (typeof cartId !== "string" || !cartId || cartId.length > 128 || typeof storeId !== "string" || !storeId || storeId.length > 128 || typeof addressId !== "string" || addressId.length > 128 || !Number.isSafeInteger(cartVersion) || Number(cartVersion) < 1 || !isCheckoutFulfillmentMode(fulfillmentMode)) return null;
  return { cartId, storeId, addressId, cartVersion: Number(cartVersion), fulfillmentMode };
}

function parseCheckoutRequest(value: unknown, compact: boolean): MultiStoreCheckoutRequest | null {
  let id: unknown;
  let rawChildren: unknown;
  if (compact && Array.isArray(value) && value.length === 2) {
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
  return { id, children: children as MultiStoreCheckoutRequest["children"] };
}

function parsePendingMultiStoreAttempt(raw: string | null, actorID: string): PendingMultiStoreAttempt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const version = value.version;
    if ((version !== 1 && version !== 2) || value.actorID !== actorID || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 8 || value.idempotencyKey.length > 128 || typeof value.correlationID !== "string" || value.correlationID.length < 8 || value.correlationID.length > 128) return null;
    const common = { version: 2 as const, actorID, idempotencyKey: value.idempotencyKey, correlationID: value.correlationID };
    if (value.kind === "CREATE") {
      const request = parseCheckoutRequest(value.request, version === 2);
      return request ? { ...common, kind: "CREATE", request } : null;
    }
    if (value.kind === "CANCEL" && typeof value.checkoutID === "string" && value.checkoutID.length > 0 && value.checkoutID.length <= 128 && Number.isSafeInteger(value.expectedVersion) && Number(value.expectedVersion) > 0) {
      return { ...common, kind: "CANCEL", checkoutID: value.checkoutID, expectedVersion: Number(value.expectedVersion) };
    }
    return null;
  } catch {
    return null;
  }
}

function serializePendingMultiStoreAttempt(attempt: PendingMultiStoreAttempt): string {
  if (attempt.kind === "CANCEL") return JSON.stringify(attempt);
  const request: CompactCheckoutRequest = [
    attempt.request.id,
    attempt.request.children.map((child) => [child.cartId, child.storeId, child.addressId, child.cartVersion, child.fulfillmentMode]),
  ];
  return JSON.stringify({ ...attempt, request });
}

function isDshHttpStatus(error: unknown, status: number): boolean {
  return Boolean(error && typeof error === "object" && (error as { kind?: unknown }).kind === "http" && (error as { status?: unknown }).status === status);
}

type PendingMultiStoreOutcome = Readonly<{ checkout?: MultiStoreCheckout; terminal: boolean; attempt?: PendingMultiStoreAttempt; error?: unknown }>;

function isTerminalMultiStoreCheckout(checkout: MultiStoreCheckout): boolean {
  return checkout.state === "COMPLETE" || checkout.state === "FAILED" || checkout.state === "PARTIAL_FAILURE" || checkout.state === "CANCELLED";
}

function canCancelMultiStoreCheckout(checkout: MultiStoreCheckout | undefined): checkout is MultiStoreCheckout {
  return Boolean(checkout && checkout.state !== "PROCESSING" && checkout.children.some((child) => child.state === "SUCCEEDED"));
}

function isTerminalMultiStoreCancel(checkout: MultiStoreCheckout): boolean {
  return checkout.children.every((child) => child.state !== "SUCCEEDED");
}

async function cancelAndReadBack(attempt: Extract<PendingMultiStoreAttempt, { kind: "CANCEL" }>): Promise<PendingMultiStoreOutcome> {
  try {
    const checkout = (await cancelMultiStoreCheckout(attempt.checkoutID, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID)).checkout;
    return { checkout, terminal: isTerminalMultiStoreCancel(checkout) };
  } catch (error) {
    try {
      const checkout = (await readOwnMultiStoreCheckout(attempt.checkoutID)).checkout;
      return { checkout, terminal: isTerminalMultiStoreCancel(checkout), error };
    } catch {
      return { terminal: false, error };
    }
  }
}

async function persistAndRetryMultiStoreCancel(
  attempt: Extract<PendingMultiStoreAttempt, { kind: "CANCEL" }>,
  checkout: MultiStoreCheckout,
): Promise<PendingMultiStoreOutcome> {
  const rebasedAttempt: PendingMultiStoreAttempt = {
    ...attempt,
    idempotencyKey: `multi_cancel_${Crypto.randomUUID()}`,
    correlationID: `multi_cancel_corr_${Crypto.randomUUID()}`,
    expectedVersion: checkout.version,
  };
  try {
    await SecureStore.setItemAsync(pendingMultiStoreAttemptKey(attempt.actorID), serializePendingMultiStoreAttempt(rebasedAttempt));
  } catch (error) {
    return { checkout, terminal: false, attempt, error };
  }
  return { ...(await cancelAndReadBack(rebasedAttempt)), attempt: rebasedAttempt };
}

async function resolvePendingMultiStoreCancel(attempt: Extract<PendingMultiStoreAttempt, { kind: "CANCEL" }>): Promise<PendingMultiStoreOutcome> {
  let checkout: MultiStoreCheckout;
  try {
    checkout = (await readOwnMultiStoreCheckout(attempt.checkoutID)).checkout;
  } catch (error) {
    return { terminal: false, attempt, error };
  }
  if (isTerminalMultiStoreCancel(checkout)) return { checkout, terminal: true };
  const outcome = await cancelAndReadBack(attempt);
  const currentCheckout = outcome.checkout;
  const canRebase = isDshHttpStatus(outcome.error, 409) && currentCheckout?.state !== "PROCESSING" && currentCheckout?.children.some((child) => child.state === "SUCCEEDED");
  if (canRebase && currentCheckout) return persistAndRetryMultiStoreCancel(attempt, currentCheckout);
  return { ...outcome, attempt };
}

async function resolvePendingMultiStoreAttempt(attempt: PendingMultiStoreAttempt): Promise<PendingMultiStoreOutcome> {
  if (attempt.kind === "CANCEL") return resolvePendingMultiStoreCancel(attempt);
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
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [pendingAttempt, setPendingAttempt] = useState<PendingMultiStoreAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadRequestID = useRef(0);

  const load = useCallback(async () => {
    const requestID = ++loadRequestID.current;
    if (!selectedCityID) {
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    setError("");
    try {
      const actorID = await authenticatedClientActorID();
      const storageKey = pendingMultiStoreAttemptKey(actorID);
      const rawAttempt = await SecureStore.getItemAsync(storageKey);
      const attempt = rawAttempt ? parsePendingMultiStoreAttempt(rawAttempt, actorID) : null;
      if (rawAttempt && !attempt) throw new Error("PENDING_MULTI_STORE_CHECKOUT_INVALID");
      const [cartResponse, addressResponse] = await Promise.all([listOwnOpenCarts(), listOwnDeliveryAddresses()]);
      const currentCityCarts = cartResponse.carts.filter((cart) => cart.serviceCityId === selectedCityID);
      const otherCityCartCount = cartResponse.carts.length - currentCityCarts.length;
      const storeCarts = currentCityCarts.map((store) => ({ store, cart: { id: store.cartId, version: store.cartVersion, lineCount: store.lineCount } }));
      let checkout: MultiStoreCheckout | undefined;
      let unresolvedAttempt = attempt;
      let attemptError = "";
      if (attempt) {
        const outcome = await resolvePendingMultiStoreAttempt(attempt);
        checkout = outcome.checkout;
        if (outcome.attempt) unresolvedAttempt = outcome.attempt;
        if (outcome.error) attemptError = "تعذر تأكيد نتيجة الطلب السابق. ستبقى المحاولة محفوظة؛ تحقق من حالتها لإكمال الاستعادة بأمان.";
        if (outcome.terminal) {
          await SecureStore.deleteItemAsync(storageKey);
          unresolvedAttempt = null;
        }
      }
      if (requestID !== loadRequestID.current) return;
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
      const fulfillmentModes = Object.fromEntries(storeCarts.map(({ store }) => [store.storeId, null]));
      const selectedStoreIDs = storeCarts.length <= 10 ? storeCarts.map(({ store }) => store.storeId) : [];
      setState({ kind: "ready", storeCarts, otherCityCartCount, selectedStoreIDs, addresses: addressResponse.addresses, selectedAddressID: addressResponse.addresses[0]?.id ?? "", fulfillmentModes, ...(checkout ? { checkout } : {}) });
    } catch {
      if (requestID === loadRequestID.current) setState({ kind: "error" });
    }
  }, [selectedCityID]);

  useEffect(() => {
    void load();
    return () => { loadRequestID.current += 1; };
  }, [load]);

  async function submit() {
    if (busy || pendingAttempt || state.kind !== "ready" || state.checkout || state.selectedStoreIDs.length < 2 || state.selectedStoreIDs.length > 10) return;
    const selectedStoreCarts = state.storeCarts.flatMap(({ store, cart }) => {
      if (!state.selectedStoreIDs.includes(store.storeId)) return [];
      const fulfillmentMode = selectedFulfillmentMode(store, state.fulfillmentModes);
      return store.publicationState === "published" && fulfillmentMode ? [{ store, cart, fulfillmentMode }] : [];
    });
    if (selectedStoreCarts.length !== state.selectedStoreIDs.length) return;
    const requiresDeliveryAddress = selectedStoreCarts.some(({ fulfillmentMode }) => fulfillmentMode !== "CUSTOMER_PICKUP");
    if (requiresDeliveryAddress && !state.selectedAddressID) return;
    setBusy(true);
    setError("");
    try {
      const actorID = await authenticatedClientActorID();
      const request: MultiStoreCheckoutRequest = {
        id: `multi_${Crypto.randomUUID()}`,
        children: selectedStoreCarts.map(({ store, cart, fulfillmentMode }) => ({ cartId: cart.id, storeId: store.storeId, addressId: fulfillmentMode === "CUSTOMER_PICKUP" ? "" : state.selectedAddressID, cartVersion: cart.version, fulfillmentMode })),
      };
      const attempt: PendingMultiStoreAttempt = {
        version: 2, kind: "CREATE", actorID, idempotencyKey: `multi_idem_${Crypto.randomUUID()}`, correlationID: `multi_corr_${Crypto.randomUUID()}`,
        request,
      };
      await SecureStore.setItemAsync(pendingMultiStoreAttemptKey(actorID), serializePendingMultiStoreAttempt(attempt));
      setPendingAttempt(attempt);
      let checkout: MultiStoreCheckout;
      try {
        checkout = (await createMultiStoreCheckout(request, attempt.idempotencyKey, attempt.correlationID)).checkout;
      } catch {
        const outcome = await resolvePendingMultiStoreAttempt(attempt);
        if (!outcome.checkout) throw outcome.error ?? new Error("CHECKOUT_OUTCOME_UNKNOWN");
        checkout = outcome.checkout;
      }
      if (isTerminalMultiStoreCheckout(checkout)) {
        await SecureStore.deleteItemAsync(pendingMultiStoreAttemptKey(actorID));
        setPendingAttempt(null);
      }
      setState((current) => current.kind === "ready" ? { ...current, checkout } : current);
    } catch {
      setError(pendingAttempt ? "تعذر تأكيد نتيجة المحاولة المحفوظة. لا تبدأ طلبًا جديدًا؛ تحقق من حالتها." : "تعذر إتمام الطلبات. إذا انقطع الاتصال فستُستعاد نتيجة المحاولة نفسها بأمان.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy || pendingAttempt || state.kind !== "ready" || !canCancelMultiStoreCheckout(state.checkout)) return;
    setBusy(true);
    setError("");
    try {
      const actorID = await authenticatedClientActorID();
      const attempt: PendingMultiStoreAttempt = {
        version: 2, kind: "CANCEL", actorID, idempotencyKey: `multi_cancel_${Crypto.randomUUID()}`, correlationID: `multi_cancel_corr_${Crypto.randomUUID()}`,
        checkoutID: state.checkout.id, expectedVersion: state.checkout.version,
      };
      await SecureStore.setItemAsync(pendingMultiStoreAttemptKey(actorID), serializePendingMultiStoreAttempt(attempt));
      setPendingAttempt(attempt);
      const outcome = await resolvePendingMultiStoreAttempt(attempt);
      const resolvedCheckout = outcome.checkout;
      if (!resolvedCheckout) throw outcome.error ?? new Error("MULTI_STORE_CANCEL_OUTCOME_UNKNOWN");
      if (outcome.terminal) {
        await SecureStore.deleteItemAsync(pendingMultiStoreAttemptKey(actorID));
        setPendingAttempt(null);
      }
      setState((current) => current.kind === "ready" ? { ...current, checkout: resolvedCheckout } : current);
      if (outcome.attempt && !outcome.terminal) setPendingAttempt(outcome.attempt);
      if (outcome.error) setError("تعذر تأكيد نتيجة الإلغاء. ستبقى المحاولة محفوظة؛ تحقق من حالتها لإكمال الاستعادة بأمان.");
    } catch {
      setError("تعذر إلغاء الطلبات التابعة بالكامل. ستظهر نتيجة كل متجر بشكل مستقل.");
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <View style={styles.state} accessibilityLabel="جارٍ تجهيز طلب المتاجر"><BthwaniSkeleton width="50%" height={26} /><BthwaniSkeleton height={92} /><BthwaniSkeleton height={120} /></View>;
  if (state.kind === "error") return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" style={styles.title}>تعذر تجهيز الطلب المتعدد</Text><Text style={styles.muted}>تحقق من مدينة الخدمة والاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /></View>;
  if (state.kind === "empty") return <View style={styles.state}><BthwaniIcon name="cart" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>{state.otherCityCartCount > 0 ? "سلالك في مدينة خدمة أخرى" : "سلة التسوق فارغة"}</Text><Text style={styles.muted}>{state.otherCityCartCount > 0 ? "غيّر مدينة الخدمة لعرض السلال المحفوظة هناك." : "أضف منتجات من المتاجر لتظهر سلالك هنا."}</Text><BthwaniButton label="استكشف المتاجر" onPress={() => router.push("/home" as Href)} /><BthwaniButton label="تحديث السلال" onPress={() => void load()} variant="secondary" /></View>;
  if (state.kind === "single") return <View style={styles.state} accessibilityLabel="سلة متجر"><BthwaniIcon name="cart" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>لديك سلة من {state.storeCart.store.storeName}</Text><Text style={styles.muted}>{state.storeCart.cart.lineCount} منتجات جاهزة للمراجعة.</Text>{state.otherCityCartCount > 0 ? <Text style={styles.muted}>لديك أيضًا سلال محفوظة في مدينة خدمة أخرى.</Text> : null}<BthwaniButton label="فتح سلة المتجر" onPress={() => router.push(`/cart/${encodeURIComponent(state.storeCart.store.storeId)}` as Href)} /><BthwaniButton label="تحديث السلال" onPress={() => void load()} variant="secondary" /></View>;

  const checkout = state.checkout;
  const canCancel = canCancelMultiStoreCheckout(checkout);
  if (pendingAttempt) return <View style={styles.container} accessibilityLabel="استعادة الطلب المتعدد"><BthwaniSurface tone="raised" style={styles.hero}><View style={styles.heroIcon}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconXl} /></View><View style={styles.heroCopy}><Text style={styles.eyebrow}>استعادة الطلب</Text><Text style={styles.title}>نتحقق من النتيجة المحفوظة</Text><Text style={styles.muted}>لن نرسل طلبًا جديدًا. نقرأ النتيجة أولًا ثم نتابع الطلب نفسه بمفتاحه الثابت.</Text></View></BthwaniSurface>{checkout ? <CheckoutSummary checkout={checkout} styles={styles} theme={theme} /> : <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.cardTitle}>النتيجة لم تُحسم بعد</Text><Text style={styles.muted}>المحاولة محفوظة على هذا الجهاز لهذا الحساب. أعد التحقق عند عودة الاتصال.</Text></BthwaniSurface>}<BthwaniButton busy={busy} disabled={busy} label="تحقق وأكمل الاستعادة" onPress={() => void load()} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</View>;
  if (checkout && state.storeCarts.length === 0) return <View style={styles.container} accessibilityLabel="نتيجة طلب المتاجر"><CheckoutSummary checkout={checkout} styles={styles} theme={theme} />{canCancel ? <BthwaniButton accessibilityLabel="إلغاء الطلب المتعدد" busy={busy} disabled={busy} label="إلغاء الطلبات التابعة" onPress={() => void cancel()} variant="secondary" /> : null}<BthwaniButton label="تحديث السلال" onPress={() => void load()} variant="secondary" /></View>;
  const selectedStoreCarts = state.storeCarts.filter(({ store }) => state.selectedStoreIDs.includes(store.storeId));
  const hasUnsupportedStore = selectedStoreCarts.some(({ store }) => store.publicationState !== "published" || availableCustomerFulfillmentModes(store.fulfillmentModes).length === 0);
  const requiresDeliveryAddress = selectedStoreCarts.some(({ store }) => { const mode = state.fulfillmentModes[store.storeId]; return mode !== null && mode !== "CUSTOMER_PICKUP"; });
  const canSubmitCheckout = !pendingAttempt && state.selectedStoreIDs.length >= 2 && state.selectedStoreIDs.length <= 10 && selectedStoreCarts.length === state.selectedStoreIDs.length;
  return (
    <View style={styles.container} accessibilityLabel="إتمام الطلب من عدة متاجر">
      <BthwaniSurface tone="raised" style={styles.hero}><View style={styles.heroIcon}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconXl} /></View><View style={styles.heroCopy}><Text style={styles.eyebrow}>طلب متعدد المتاجر</Text><Text style={styles.title}>طلبات مستقلة، متابعة واحدة</Text><Text style={styles.muted}>ينشئ بثواني طلبًا مستقلًا لكل متجر ويحفظ نتيجة كل واحد بوضوح.</Text></View></BthwaniSurface>
      {state.otherCityCartCount > 0 ? <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.muted}>لديك {state.otherCityCartCount} سلة محفوظة في مدينة خدمة أخرى. غيّر المدينة لعرضها.</Text></BthwaniSurface> : null}
      <BthwaniSectionHeader title="السلال الجاهزة" subtitle={`${state.selectedStoreIDs.length} محددة من ${state.storeCarts.length} · الحد الأعلى 10`} />
      <View style={styles.list}>{state.storeCarts.map(({ store, cart }) => {
        const selectedMode = selectedFulfillmentMode(store, state.fulfillmentModes);
        const availableModes = availableCustomerFulfillmentModes(store.fulfillmentModes);
        const selected = state.selectedStoreIDs.includes(store.storeId);
        const eligible = store.publicationState === "published" && availableModes.length > 0;
        return <BthwaniSurface key={store.storeId} tone="inset" style={styles.storeCard}>
          <View style={styles.storeIcon}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View>
          <View style={styles.storeCopy}><Text style={styles.cardTitle}>{store.storeName}</Text><Text style={styles.muted}>{cart.lineCount} منتجات · السلة #{cart.version}</Text></View>
          <BthwaniChip disabled={busy || Boolean(checkout) || (!selected && (!eligible || state.selectedStoreIDs.length >= 10))} label={selected ? "ضمن الطلب" : "أضف للطلب"} onPress={() => setState((current) => {
            if (current.kind !== "ready" || current.checkout) return current;
            const isSelected = current.selectedStoreIDs.includes(store.storeId);
            if (!isSelected && (!eligible || current.selectedStoreIDs.length >= 10)) return current;
            return { ...current, selectedStoreIDs: isSelected ? current.selectedStoreIDs.filter((id) => id !== store.storeId) : [...current.selectedStoreIDs, store.storeId] };
          })} selected={selected} />
          <View style={styles.storeModes} accessibilityLabel={`طريقة استلام الطلب من ${store.storeName}`}>
            {!eligible ? <Text accessibilityRole="alert" style={styles.error}>{store.publicationState !== "published" ? "المتجر غير منشور حاليًا؛ سلتك محفوظة ويمكنك فتحها." : "لا يتوفر لهذا المتجر وضع طلب حاليًا."}</Text> : selected && availableModes.length > 0 ? availableModes.map((mode) => <BthwaniChip key={mode} disabled={busy || Boolean(checkout)} label={fulfillmentModeLabel(mode)} onPress={() => setState((current) => current.kind === "ready" && !current.checkout ? { ...current, fulfillmentModes: { ...current.fulfillmentModes, [store.storeId]: mode } } : current)} selected={selectedMode === mode} />) : null}
            {selected && eligible && selectedMode === null ? <Text accessibilityRole="alert" style={styles.error}>اختر وضع الطلب لهذا المتجر.</Text> : selectedMode && selected ? <Text style={styles.muted}>{modeDescription(selectedMode)}</Text> : null}
            {!eligible ? <BthwaniChip label="فتح السلة" onPress={() => router.push(`/cart/${encodeURIComponent(store.storeId)}` as Href)} /> : null}
          </View>
        </BthwaniSurface>;
      })}</View>
      {selectedStoreCarts.length === 1 ? <BthwaniButton label="فتح سلة المتجر المحدد" onPress={() => { const only = selectedStoreCarts[0]; if (only) router.push(`/cart/${encodeURIComponent(only.store.storeId)}` as Href); }} /> : null}
      {selectedStoreCarts.length < 2 ? <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.cardTitle}>حدد سلتين على الأقل</Text><Text style={styles.muted}>يمكنك معالجة سلتين إلى 10 سلال في كل طلب متعدد.</Text></BthwaniSurface> : null}
      {requiresDeliveryAddress ? <>
        <BthwaniSectionHeader title="عنوان التوصيل" subtitle="يُعاد التحقق من الأهلية لكل متجر اخترت توصيله عند الإتمام." />
        <View style={styles.list}>{state.addresses.map((address) => { const selected = address.id === state.selectedAddressID; return <Pressable key={address.id} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setState((current) => current.kind === "ready" ? { ...current, selectedAddressID: address.id } : current)} style={[styles.address, selected && styles.addressSelected]}><Text style={styles.addressText}>{address.addressText}</Text><Text style={styles.muted}>{selected ? "العنوان المختار" : "استخدام هذا العنوان"}</Text></Pressable>; })}</View>
        {state.addresses.length === 0 ? <Text accessibilityRole="alert" style={styles.error}>أضف عنوان توصيل من الحساب قبل إتمام الطلبات التي اخترت توصيلها.</Text> : null}
      </> : selectedStoreCarts.length >= 2 ? hasUnsupportedStore ? <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.error}>أزل المتجر غير المتاح من هذا الطلب، أو أعد المحاولة بعد إتاحته.</Text></BthwaniSurface> : selectedStoreCarts.some(({ store }) => !state.fulfillmentModes[store.storeId]) ? <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.cardTitle}>اختر وضع الطلب لكل متجر محدد</Text><Text style={styles.muted}>سيظهر عنوان التوصيل للمتاجر التي اخترت لها أحد وضعي التوصيل.</Text></BthwaniSurface> : <BthwaniSurface tone="inset" style={styles.summary}><Text style={styles.cardTitle}>المتاجر المحددة تدعم أوضاع الطلب المختارة</Text><Text style={styles.muted}>يُطلب العنوان فقط للمتاجر التي اخترت لها التوصيل.</Text></BthwaniSurface> : null}
      {checkout ? <CheckoutSummary checkout={checkout} styles={styles} theme={theme} /> : selectedStoreCarts.length >= 2 ? <BthwaniButton accessibilityLabel="إتمام الطلب من عدة متاجر" busy={busy} disabled={busy || !canSubmitCheckout || hasUnsupportedStore || selectedStoreCarts.some(({ store }) => !state.fulfillmentModes[store.storeId]) || (requiresDeliveryAddress && !state.selectedAddressID)} label={`إتمام الطلب من ${selectedStoreCarts.length} متاجر`} onPress={() => void submit()} /> : null}
      {checkout && canCancel ? <BthwaniButton accessibilityLabel="إلغاء الطلب المتعدد" busy={busy} disabled={busy} label="إلغاء الطلبات التابعة" onPress={() => void cancel()} variant="secondary" /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function selectedFulfillmentMode(store: ClientOpenCartSummary, selected: Readonly<Record<string, CustomerFulfillmentMode | null>>): CustomerFulfillmentMode | null {
  const mode = selected[store.storeId] ?? null;
  return mode && store.fulfillmentModes.includes(mode) ? mode : null;
}

function modeDescription(mode: CustomerFulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "المنصة تتولى التوصيل.";
  if (mode === "PARTNER_CAPTAIN") return "المتجر يختار أحد كباتنه، ولا توجد رسوم توصيل في الإصدار الأول.";
  return "تذهب إلى المتجر لاستلام طلبك بنفسك.";
}

function CheckoutSummary({ checkout, styles, theme }: { checkout: MultiStoreCheckout; styles: ReturnType<typeof createStyles>; theme: ReturnType<typeof resolveTheme> }) {
  const stateLabel = checkout.state === "COMPLETE" ? "اكتملت كل الطلبات" : checkout.state === "CANCELLED" ? "أُلغيت الطلبات التابعة" : checkout.state === "PARTIAL_FAILURE" ? "اكتمل جزء من الطلبات" : checkout.state === "FAILED" ? "تعذر إنشاء الطلبات" : "جارٍ معالجة الطلبات";
  return <BthwaniSurface tone="raised" style={styles.summary}><Text style={styles.cardTitle}>{stateLabel}</Text><Text style={styles.muted}>{checkout.successfulChildCount} ناجحة · {checkout.failedChildCount} متعثرة من {checkout.childCount}</Text><View style={styles.childList}>{checkout.children.map((child) => <View key={child.id} style={styles.childRow}><View style={styles.childCopy}><Text style={styles.childStore}>{child.storeName}</Text><Text style={styles.childMode}>{fulfillmentModeLabel(child.fulfillmentMode)}</Text>{child.failureCode ? <Text style={styles.childMode}>{checkoutChildFailureLabel(child.failureCode)}</Text> : null}</View><Text style={{ ...styles.childState, color: child.state === "SUCCEEDED" || child.state === "CANCELLED" ? theme.success : child.state === "FAILED" || child.state === "CANCEL_FAILED" ? theme.danger : theme.warning }}>{checkoutChildStateLabel(child.state)}</Text></View>)}</View></BthwaniSurface>;
}

function checkoutChildFailureLabel(code: string): string {
  if (code === "PAYMENT_RECONCILED") return "أُلغيت محاولة الدفع السابقة بأمان؛ حدّث السلة ثم أعد الإرسال.";
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
  return StyleSheet.create({
    container: { gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    hero: { alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    heroIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    heroCopy: { flex: 1, gap: spacing[1] },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleLg, color: theme.color, textAlign: "center" },
    cardTitle: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    list: { gap: spacing[2] },
    storeCard: { alignItems: "center", borderRadius: radius.lg, flexDirection: "row", flexWrap: "wrap", gap: spacing[3], padding: spacing[3] },
    storeIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    storeCopy: { flex: 1, gap: spacing[1] },
    storeModes: { flexBasis: "100%", flexDirection: "row", flexWrap: "wrap", gap: spacing[1] },
    address: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    addressSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    addressText: { ...typography.bodyStrong, color: theme.color },
    summary: { borderRadius: radius.lg, gap: spacing[2], padding: spacing[4] },
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
