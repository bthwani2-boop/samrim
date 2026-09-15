import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import type { Order } from "@bthwani/dsh";
import { createDshMobileClient } from "@bthwani/dsh";
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

  async function transition(order: Order) {
    const state = nextState(order);
    if (!state || busy) return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().transitionStoreOrder(token, storeId, order.id, { state }, order.version); await load(); }
    catch (cause) { console.error("DSH order transition failed", cause); setError("تعذر تحديث حالة الطلب. أعد القراءة ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  return <View style={styles.container} accessibilityLabel="إدارة طلبات المتجر"><Text style={styles.title}>طلبات المتجر</Text><Text style={styles.muted}>تظهر الطلبات بعد إتمام العميل، وتنتقل هنا حتى تصبح جاهزة للتسليم.</Text>{loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الطلبات…</Text></View> : null}{!loading && !orders.length ? <Text style={styles.muted}>لا توجد طلبات جديدة.</Text> : null}{orders.map((order) => { const next = nextState(order); return <View key={order.id} style={styles.order}><Text style={styles.orderTitle}>طلب {order.id}</Text><Text style={styles.muted}>الحالة: {order.state} · الإجمالي: {order.totalAmountMinor} {order.currency} · الإصدار {order.version}</Text><Text style={styles.muted}>{order.lines.length} منتج · العنوان: {order.addressText}</Text>{next ? <Pressable accessibilityRole="button" accessibilityState={{ busy: busy === order.id }} disabled={Boolean(busy)} onPress={() => void transition(order)} style={styles.button}><Text style={styles.buttonText}>{busy === order.id ? "جارٍ الحفظ…" : next === "PARTNER_ACCEPTED" ? "قبول الطلب" : next === "PREPARING" ? "بدء التجهيز" : "جاهز للتسليم"}</Text></Pressable> : null}</View>; })}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>تحديث الطلبات</Text></Pressable></View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 10, marginTop: 16, padding: 14, width: "100%" },
    title: { color: theme.structure, fontSize: 17, fontWeight: "800" },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19 },
    state: { alignItems: "center", gap: 8, paddingVertical: 8 },
    order: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 5, padding: 10 },
    orderTitle: { color: theme.structure, fontSize: 14, fontWeight: "800" },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    buttonText: { color: theme.surface, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
    secondaryButtonText: { color: theme.structure, fontSize: 13, fontWeight: "700" },
    error: { color: theme.danger, fontSize: 13 },
  });
}
