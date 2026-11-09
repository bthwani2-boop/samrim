import { BthwaniButton, BthwaniConfirmDialog, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, formatOrderDate, type IndependentPartnerPickupOrder, type IndependentPickupOrderState, type IndependentPickupOrderTransitionRequest } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope";
import { createPartnerSurfaceStyles } from "../partner-onboarding/partner-surface-styles";
import { listIndependentPickupOrders, transitionIndependentPickupOrder } from "../partner-onboarding/store-readback-client";
import { isCurrentOrderListRequest, reconcileVersionedOrderPage, tryAcquireOrderAction } from "./order-page-records";

type Transition = IndependentPickupOrderTransitionRequest["state"];
const states: Record<IndependentPickupOrderState, string> = {
  SUBMITTED: "جديد", ACCEPTED: "مقبول", PREPARING: "قيد التجهيز",
  READY: "جاهز للاستلام", COMPLETED: "تم الاستلام", REJECTED: "مرفوض", CANCELLED: "ملغى",
};
const next: Partial<Record<IndependentPickupOrderState, { state: Transition; label: string }>> = {
  SUBMITTED: { state: "ACCEPTED", label: "قبول الطلب" },
  ACCEPTED: { state: "PREPARING", label: "بدء التجهيز" },
  PREPARING: { state: "READY", label: "جاهز للاستلام" },
  READY: { state: "COMPLETED", label: "تأكيد الاستلام" },
};
const currentScope = () => partnerSetupSessionKey(currentIdentityState());

async function scopedToken(scope: string) {
  const token = await getUsableIdentityAccessToken();
  if (!scope || scope !== currentScope()) throw new Error("PARTNER_SESSION_CHANGED");
  return token;
}

export function IndependentPickupOrders({ storeID, canAdvance }: Readonly<{ storeID: string; canAdvance: boolean }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [scope, setScope] = useState(currentScope);
  const scopeKey = JSON.stringify([scope, storeID]);
  const [visibleScopeKey, setVisibleScopeKey] = useState("");
  const [orders, setOrders] = useState<ReadonlyArray<IndependentPartnerPickupOrder>>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyOrder, setBusyOrder] = useState("");
  const [confirm, setConfirm] = useState<{ order: IndependentPartnerPickupOrder; state: "COMPLETED" | "REJECTED" } | null>(null);
  const [reason, setReason] = useState("");
  const generation = useRef(0);
  const scopeEpoch = useRef(0);
  const activeScopeKey = useRef(scopeKey);
  activeScopeKey.current = scopeKey;
  const locks = useRef(new Set<string>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeIdentitySession((identity) => {
      const changed = partnerSetupSessionKey(identity);
      if (changed === scope) return;
      generation.current += 1;
      scopeEpoch.current += 1;
      setOrders([]);
      setCursor("");
      setVisibleScopeKey("");
      setError("");
      setBusyOrder("");
      setConfirm(null);
      setScope(changed);
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, [scope]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Scope change must synchronously clear order and dialog state even for the same actor.
  useEffect(() => {
    // Remove Store A's data and pending dialogs when Store B is selected.
    generation.current += 1;
    scopeEpoch.current += 1;
    setOrders([]);
    setCursor("");
    setLoading(true);
    setError("");
    setBusyOrder("");
    setConfirm(null);
    setReason("");
  }, [scopeKey]);

  const load = useCallback(async (after = "") => {
    const request = ++generation.current;
    const isCurrent = () => mounted.current && currentScope() === scope &&
      isCurrentOrderListRequest(request, scopeKey, generation.current, activeScopeKey.current);
    setLoading(true);
    setError("");
    try {
      const result = await listIndependentPickupOrders(await scopedToken(scope), storeID, after);
      if (!isCurrent()) return;
      if (result.orders.some(order => order.storeId !== storeID) || (after && result.nextCursor === after)) throw new Error("DIRECT_ORDER_SCOPE_MISMATCH");
      setOrders(previous => reconcileVersionedOrderPage(previous, result.orders, Boolean(after)));
      setCursor(result.nextCursor);
      setVisibleScopeKey(scopeKey);
    } catch {
      if (isCurrent()) {
        // A rejected revalidation must not leave formerly authorized orders on screen.
        setOrders([]);
        setCursor("");
        setVisibleScopeKey("");
        setConfirm(null);
        setError("تعذر قراءة طلبات الاستلام. أعد المحاولة.");
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [scope, scopeKey, storeID]);

  useFocusEffect(useCallback(() => {
    if (scope) void load();
    return () => { generation.current += 1; };
  }, [load, scope]));

  const transition = async (order: IndependentPartnerPickupOrder, state: Transition) => {
    if (!canAdvance || busyOrder || order.storeId !== storeID || visibleScopeKey !== scopeKey) return;
    const requestedScopeKey = scopeKey;
    const requestedEpoch = scopeEpoch.current;
    const isCurrentAction = () => mounted.current && currentScope() === scope &&
      isCurrentOrderListRequest(requestedEpoch, requestedScopeKey, scopeEpoch.current, activeScopeKey.current);
    const release = tryAcquireOrderAction(locks.current, requestedScopeKey + ":" + order.orderId);
    if (!release) return;
    setBusyOrder(order.orderId);
    setError("");
    try {
      const token = await scopedToken(scope);
      // Do not dispatch a Store A mutation after the user has switched to B.
      if (!isCurrentAction()) return;
      const result = await transitionIndependentPickupOrder(token, storeID, order.orderId, {
        state, expectedVersion: order.version, ...(state === "REJECTED" ? { reason: reason.trim() } : {}),
      });
      if (!isCurrentAction()) return;
      if (result.storeId !== storeID || result.orderId !== order.orderId || result.version <= order.version) throw new Error("DIRECT_ORDER_SCOPE_MISMATCH");
      setOrders(previous => previous.map(item => item.orderId === order.orderId && item.version < result.version ? { ...item, ...result } : item));
      setConfirm(null);
    } catch {
      if (isCurrentAction()) {
        setConfirm(null);
        await load();
        if (isCurrentAction()) setError("تعذر تأكيد التحديث. راجع حالة الطلب قبل المحاولة مجددًا.");
      }
    } finally {
      release();
      if (isCurrentAction()) setBusyOrder("");
    }
  };

  if (!scope || scope !== currentScope()) return null;
  const visible = visibleScopeKey === scopeKey;
  return <View style={styles.container}>
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>طلبات الاستلام المباشر</Text>
      <Text style={styles.muted}>يدفع العميل للمتجر عند الاستلام.</Text>
      <BthwaniButton label="تحديث الطلبات" disabled={loading || Boolean(busyOrder)} variant="secondary" onPress={() => void load()} />
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {loading || (!visible && !error) ? <ActivityIndicator accessibilityLabel="جارٍ قراءة الطلبات" color={theme.actionBackground} /> : null}
    {!loading && visible && orders.length === 0 ? <View style={styles.card}><Text style={styles.muted}>لا توجد طلبات استلام لهذا المتجر.</Text></View> : null}
    {!loading && visible && orders.map(order => {
      const action = next[order.state];
      return <View key={order.orderId} style={styles.card}>
        <Text accessibilityRole="header" style={styles.value}>{states[order.state]} · {formatMoney(order.totalMinor, "YER")}</Text>
        <Text selectable style={styles.muted}>{order.orderId}</Text>
        <Text style={styles.metaLabel}>{formatOrderDate(order.createdAt)}</Text>
        {order.lines.map(line => <Text key={line.offerId} style={styles.muted}>
          {line.productName}{line.variantTitle ? " · " + line.variantTitle : ""} × {line.quantityBaseUnits.toLocaleString("ar-YE")}
        </Text>)}
        {canAdvance && action ? <View style={styles.choiceRow}>
          <BthwaniButton label={action.label} disabled={loading || Boolean(busyOrder)}
            onPress={() => action.state === "COMPLETED" ? setConfirm({ order, state: "COMPLETED" }) : void transition(order, action.state)} />
          {order.state === "SUBMITTED" ? <BthwaniButton label="رفض الطلب" variant="secondary" disabled={loading || Boolean(busyOrder)}
            onPress={() => { setReason(""); setConfirm({ order, state: "REJECTED" }); }} /> : null}
        </View> : null}
      </View>;
    })}
    {!loading && visible && cursor ? <BthwaniButton label="عرض طلبات أقدم" disabled={loading || Boolean(busyOrder)} variant="secondary" onPress={() => void load(cursor)} /> : null}
    {confirm && visible && confirm.order.storeId === storeID ? <BthwaniConfirmDialog visible title={confirm.state === "REJECTED" ? "رفض الطلب" : "تأكيد الاستلام"}
      description={confirm.state === "REJECTED" ? "سجّل سبب رفض الطلب." : "أكّد بعد تسليم الطلب للعميل في المتجر."}
      confirmLabel={confirm.state === "REJECTED" ? "رفض الطلب" : "تم التسليم"} intent={confirm.state === "REJECTED" ? "danger" : "primary"}
      busy={Boolean(busyOrder)} onCancel={() => setConfirm(null)}
      onConfirm={() => {
        if (confirm.state === "REJECTED" && !reason.trim()) { setError("أدخل سبب الرفض."); return; }
        void transition(confirm.order, confirm.state);
      }}>
      {confirm.state === "REJECTED" ? <TextInput accessibilityLabel="سبب الرفض" placeholder="سبب الرفض" maxLength={300}
        style={styles.formInput} value={reason} onChangeText={setReason} editable={!busyOrder} /> : null}
    </BthwaniConfirmDialog> : null}
  </View>;
}
