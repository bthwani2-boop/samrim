import { BthwaniButton, BthwaniConfirmDialog, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, formatOrderDate, type IndependentPartnerPickupOrder, type IndependentPickupOrderState, type IndependentPickupOrderTransitionRequest } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope";
import { createPartnerSurfaceStyles } from "../partner-onboarding/partner-surface-styles";
import { listIndependentPickupOrders, transitionIndependentPickupOrder } from "../partner-onboarding/store-readback-client";
import { tryAcquireOrderAction } from "./order-page-records";

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
  const [orders, setOrders] = useState<ReadonlyArray<IndependentPartnerPickupOrder>>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyOrder, setBusyOrder] = useState("");
  const [confirm, setConfirm] = useState<{ order: IndependentPartnerPickupOrder; state: "COMPLETED" | "REJECTED" } | null>(null);
  const [reason, setReason] = useState("");
  const generation = useRef(0);
  const locks = useRef(new Set<string>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeIdentitySession((identity) => {
      const changed = partnerSetupSessionKey(identity);
      if (changed === scope) return;
      generation.current += 1;
      setOrders([]);
      setCursor("");
      setError("");
      setBusyOrder("");
      setConfirm(null);
      setScope(changed);
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, [scope]);

  const load = useCallback(async (after = "") => {
    const request = ++generation.current;
    const isCurrent = () => mounted.current && request === generation.current && currentScope() === scope;
    setLoading(true);
    setError("");
    try {
      const result = await listIndependentPickupOrders(await scopedToken(scope), storeID, after);
      if (!isCurrent()) return;
      if (result.orders.some(order => order.storeId !== storeID) || (after && result.nextCursor === after)) throw new Error("DIRECT_ORDER_SCOPE_MISMATCH");
      setOrders(previous => after
        ? [...previous, ...result.orders.filter(order => !previous.some(item => item.orderId === order.orderId))]
        : result.orders);
      setCursor(result.nextCursor);
    } catch {
      if (isCurrent()) {
        // A rejected revalidation must not leave formerly authorized orders on screen.
        setOrders([]);
        setCursor("");
        setConfirm(null);
        setError("تعذر قراءة طلبات الاستلام. أعد المحاولة.");
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [scope, storeID]);

  useFocusEffect(useCallback(() => {
    if (scope) void load();
    return () => { generation.current += 1; };
  }, [load, scope]));

  const transition = async (order: IndependentPartnerPickupOrder, state: Transition) => {
    if (!canAdvance || busyOrder || order.storeId !== storeID) return;
    const release = tryAcquireOrderAction(locks.current, order.orderId);
    if (!release) return;
    setBusyOrder(order.orderId);
    setError("");
    try {
      const result = await transitionIndependentPickupOrder(await scopedToken(scope), storeID, order.orderId, {
        state, expectedVersion: order.version, ...(state === "REJECTED" ? { reason: reason.trim() } : {}),
      });
      if (!mounted.current || currentScope() !== scope) return;
      if (result.storeId !== storeID || result.orderId !== order.orderId || result.version <= order.version) throw new Error("DIRECT_ORDER_SCOPE_MISMATCH");
      setOrders(previous => previous.map(item => item.orderId === order.orderId && item.version < result.version ? { ...item, ...result } : item));
      setConfirm(null);
    } catch {
      if (mounted.current && currentScope() === scope) {
        setConfirm(null);
        await load();
        if (mounted.current && currentScope() === scope) setError("تعذر تأكيد التحديث. راجع حالة الطلب قبل المحاولة مجددًا.");
      }
    } finally {
      release();
      if (mounted.current && currentScope() === scope) setBusyOrder("");
    }
  };

  if (!scope || scope !== currentScope()) return null;
  return <View style={styles.container}>
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>طلبات الاستلام المباشر</Text>
      <Text style={styles.muted}>يدفع العميل للمتجر عند الاستلام.</Text>
      <BthwaniButton label="تحديث الطلبات" disabled={loading || Boolean(busyOrder)} variant="secondary" onPress={() => void load()} />
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {loading ? <ActivityIndicator accessibilityLabel="جارٍ قراءة الطلبات" color={theme.actionBackground} /> : null}
    {!loading && !error && orders.length === 0 ? <View style={styles.card}><Text style={styles.muted}>لا توجد طلبات استلام لهذا المتجر.</Text></View> : null}
    {!loading && !error && orders.map(order => {
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
    {!loading && !error && cursor ? <BthwaniButton label="عرض طلبات أقدم" disabled={loading || Boolean(busyOrder)} variant="secondary" onPress={() => void load(cursor)} /> : null}
    {confirm ? <BthwaniConfirmDialog visible title={confirm.state === "REJECTED" ? "رفض الطلب" : "تأكيد الاستلام"}
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
