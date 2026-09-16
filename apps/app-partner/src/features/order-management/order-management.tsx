import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { direction, resolveRowDirection, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import { createDshMobileClient, formatMoney, formatOrderDate, formatQuantity, orderStateLabel, type Order } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

function nextState(order: Order): "PARTNER_ACCEPTED" | "PREPARING" | "READY_FOR_DISPATCH" | "REJECTED" | null {
  if (order.state === "CREATED") return "PARTNER_ACCEPTED";
  if (order.state === "PARTNER_ACCEPTED") return "PREPARING";
  if (order.state === "PREPARING") return "READY_FOR_DISPATCH";
  return null;
}

export function OrderManagement({ storeId }: { storeId: string }) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); setOrders((await client().listStoreOrders(token, storeId)).orders); }
    catch (cause) { console.error("DSH order list failed", cause); setError("تعذر قراءة الطلبات. أعد المحاولة."); }
    finally { setLoading(false); }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  async function transition(order: Order, requestedState = nextState(order)) {
    const state = requestedState;
    if (!state || busy) return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().transitionStoreOrder(token, storeId, order.id, { state }, order.version); await load(); }
    catch (cause) { console.error("DSH order transition failed", cause); setError("تعذر تحديث حالة الطلب. أعد القراءة ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  return <View style={styles.container} accessibilityLabel="إدارة طلبات المتجر"><Text style={styles.title}>طلبات المتجر</Text><Text style={styles.muted}>تظهر الطلبات بعد إتمام العميل، وتنتقل هنا حتى تصبح جاهزة للتسليم.</Text>{loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الطلبات…</Text></View> : null}{!loading && !orders.length ? <Text style={styles.muted}>لا توجد طلبات جديدة.</Text> : null}{orders.map((order) => { const next = nextState(order); return <View key={order.id} style={styles.order}><Text style={styles.orderTitle}>طلب بتاريخ {formatOrderDate(order.createdAt)}</Text><Text style={styles.muted}>الحالة: {orderStateLabel(order.state)} · الإجمالي: {formatMoney(order.totalAmountMinor, order.currency)}</Text><Text style={styles.muted}>{order.lines.length} منتج · العنوان: {order.addressText}</Text><View style={styles.lines}>{order.lines.map((line) => <View key={line.id} style={styles.line}><Text style={styles.lineTitle}>{line.productName} · {line.variantTitle}</Text><Text style={styles.muted}>المطلوب: {formatQuantity(line.baseUnit, line.requestedQuantityBaseUnits)} · النهائي: {formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)}</Text><Text style={styles.muted}>{pricingBasisLabel(line.pricingBasis)} · {formatMoney(line.lineAmountMinor, line.currency)}{line.modifierAmountMinor > 0 ? ` · الإضافات: ${formatMoney(line.modifierAmountMinor, line.currency)}` : ""}</Text>{line.modifierSnapshots.length ? <Text style={styles.muted}>الإضافات المحددة: {line.modifierSnapshots.map((modifier) => modifier.optionNameAr).join("، ")}</Text> : null}{line.attributeSnapshots.length ? <Text style={styles.muted}>تفاصيل المنتج: {line.attributeSnapshots.map((attribute) => `${attribute.code}: ${attributeSnapshotValue(attribute)}`).join("، ")}</Text> : null}</View>)}</View>{next ? <View style={styles.actionRow}><Pressable accessibilityRole="button" accessibilityState={{ busy: busy === order.id, disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void transition(order)} style={[styles.button, busy && styles.disabledButton]}><Text style={[styles.buttonText, busy && styles.disabledButtonText]}>{busy === order.id ? "جارٍ الحفظ…" : next === "PARTNER_ACCEPTED" ? "قبول الطلب" : next === "PREPARING" ? "بدء التجهيز" : "جاهز للتسليم"}</Text></Pressable>{next === "PARTNER_ACCEPTED" ? <Pressable accessibilityRole="button" accessibilityState={{ busy: busy === order.id, disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void transition(order, "REJECTED")} style={[styles.rejectButton, busy && styles.disabledButton]}><Text style={[styles.rejectButtonText, busy && styles.disabledButtonText]}>رفض الطلب</Text></Pressable> : null}</View> : null}</View>; })}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void load()} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={[styles.secondaryButtonText, busy && styles.disabledButtonText]}>تحديث الطلبات</Text></Pressable></View>;
}

function pricingBasisLabel(basis: Order["lines"][number]["pricingBasis"]): string {
  return basis === "PER_UNIT" ? "لكل قطعة" : "لكل وحدة قياس";
}

function attributeSnapshotValue(attribute: Order["lines"][number]["attributeSnapshots"][number]): string {
  if (attribute.textValue) return attribute.textValue;
  if (attribute.integerValue !== undefined && attribute.integerValue !== null) return String(attribute.integerValue);
  if (attribute.decimalValue) return attribute.decimalValue;
  if (attribute.booleanValue !== undefined && attribute.booleanValue !== null) return attribute.booleanValue ? "نعم" : "لا";
  if (attribute.enumValue) return attribute.enumValue;
  if (attribute.dateValue) return attribute.dateValue;
  return "—";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const rowDirection = resolveRowDirection(activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 10, marginTop: 16, padding: 14, width: "100%", direction: activeDirection },
    title: { color: theme.color, fontSize: 17, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19, textAlign: startTextAlign },
    state: { alignItems: "center", gap: 8, paddingVertical: 8 },
    order: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 5, padding: 10 },
    lines: { gap: 8, marginTop: 4 },
    line: { borderColor: theme.borderColor, borderTopWidth: 1, gap: 3, paddingTop: 8 },
    lineTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    actionRow: { flexDirection: rowDirection, gap: 8 },
    orderTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    rejectButton: { alignItems: "center", borderColor: theme.danger, borderRadius: 8, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    rejectButtonText: { color: theme.danger, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
    secondaryButtonText: { color: theme.color, fontSize: 13, fontWeight: "700" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
  });
}
