import { borders, direction, radius, resolveTextAlign, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAssignment, captainHandoffStateLabel, createDshMobileClient, formatMoney, formatOrderDate, formatQuantity, type Order, orderStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
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
const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([]);
  const [assignments, setAssignments] = useState<Readonly<Record<string, CaptainAssignment>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const nextOrders = (await client().listStoreOrders(token, storeId)).orders;
      const entries = await Promise.all(nextOrders.filter((order) => order.state === "CAPTAIN_ASSIGNED" || order.state === "IN_CUSTODY").map(async (order) => {
        try { return [order.id, (await client().readStoreCaptainAssignment(token, storeId, order.id)).assignment] as const; }
        catch (cause) {
          if (cause && typeof cause === "object" && (cause as { kind?: unknown }).kind === "http" && (cause as { status?: unknown }).status === 404) return null;
          throw cause;
        }
      }));
      setOrders(nextOrders);
      setAssignments(Object.fromEntries(entries.filter((entry): entry is readonly [string, CaptainAssignment] => entry !== null)));
    } catch (cause) { console.error("DSH order list failed", cause); setError("تعذر قراءة الطلبات. أعد المحاولة."); }
    finally { setLoading(false); }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  async function transition(order: Order, requestedState = nextState(order)) {
    if (!requestedState || busy) return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().transitionStoreOrder(token, storeId, order.id, { state: requestedState }, order.version); await load(); }
    catch (cause) { console.error("DSH order transition failed", cause); setError("تعذر تحديث حالة الطلب. أعد القراءة ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  async function confirmHandoff(order: Order, assignment: CaptainAssignment) {
    if (busy || assignment.handoff.state !== "pending") return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().confirmCaptainStoreHandoff(token, storeId, order.id, assignment.id, assignment.handoff.version); await load(); }
    catch (cause) { console.error("DSH Captain handoff failed", cause); setError("تعذر تأكيد جاهزية التسليم. أعد القراءة ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  return <View style={styles.container} accessibilityLabel="إدارة طلبات المتجر"><Text style={styles.title}>طلبات المتجر</Text><Text style={styles.muted}>تظهر الطلبات بعد إتمام العميل، وتنتقل هنا حتى تصبح جاهزة للتسليم.</Text>{loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الطلبات…</Text></View> : null}{!loading && !orders.length ? <Text style={styles.muted}>لا توجد طلبات جديدة.</Text> : null}{orders.map((order) => { const next = nextState(order); const assignment = assignments[order.id]; return <View key={order.id} style={styles.order}><Text style={styles.orderTitle}>طلب بتاريخ {formatOrderDate(order.createdAt)}</Text><Text style={styles.muted}>الحالة: {orderStateLabel(order.state)} · الإجمالي: {formatMoney(order.totalAmountMinor, order.currency)}</Text><Text style={styles.muted}>{order.lines.length} منتج · العنوان: {order.addressText}</Text><View style={styles.lines}>{order.lines.map((line) => <View key={line.id} style={styles.line}><Text style={styles.lineTitle}>{line.productName} · {line.variantTitle}</Text><Text style={styles.muted}>المطلوب: {formatQuantity(line.baseUnit, line.requestedQuantityBaseUnits)} · النهائي: {formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)}</Text><Text style={styles.muted}>{pricingBasisLabel(line.pricingBasis)} · {formatMoney(line.lineAmountMinor, line.currency)}{line.modifierAmountMinor > 0 ? ` · الإضافات: ${formatMoney(line.modifierAmountMinor, line.currency)}` : ""}</Text>{line.modifierSnapshots.length ? <Text style={styles.muted}>الإضافات المحددة: {line.modifierSnapshots.map((modifier) => modifier.optionNameAr).join("، ")}</Text> : null}{line.attributeSnapshots.length ? <Text style={styles.muted}>تفاصيل المنتج: {line.attributeSnapshots.map((attribute) => `${attribute.code}: ${attributeSnapshotValue(attribute)}`).join("، ")}</Text> : null}</View>)}</View>{assignment ? <View style={styles.handoff}><Text style={styles.muted}>حالة تسليم المتجر: {captainHandoffStateLabel(assignment.handoff.state)}</Text>{assignment.handoff.state === "pending" ? <BthwaniButton busy={busy === order.id} disabled={Boolean(busy)} label="تأكيد جاهزية التسليم" onPress={() => void confirmHandoff(order, assignment)} /> : null}</View> : null}{next ? <View style={styles.actionRow}><BthwaniButton busy={busy === order.id} disabled={Boolean(busy)} label={next === "PARTNER_ACCEPTED" ? "قبول الطلب" : next === "PREPARING" ? "بدء التجهيز" : "جاهز للتسليم"} onPress={() => void transition(order)} style={styles.actionButton} />{next === "PARTNER_ACCEPTED" ? <BthwaniButton disabled={Boolean(busy)} label="رفض الطلب" onPress={() => void transition(order, "REJECTED")} style={styles.actionButton} variant="danger" /> : null}</View> : null}</View>; })}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="تحديث الطلبات" onPress={() => void load()} variant="secondary" /></View>;
}

function pricingBasisLabel(basis: Order["lines"][number]["pricingBasis"]): string { return basis === "PER_UNIT" ? "لكل قطعة" : "لكل وحدة قياس"; }

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
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%", direction: activeDirection },
    title: { ...typography.titleSm, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    order: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2] },
    lines: { gap: spacing[2], marginTop: spacing[1] },
    line: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[1], paddingTop: spacing[2] },
    lineTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    handoff: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], marginTop: spacing[1], padding: spacing[2] },
    actionRow: { direction: activeDirection, flexDirection: "row", gap: spacing[2] },
    orderTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    actionButton: { flex: 1 },
    error: { ...typography.label, color: theme.danger, textAlign: startTextAlign },
  });
}
