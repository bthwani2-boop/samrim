import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniSearchField, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
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

const queueFilters = [
  { key: "ALL", label: "الكل" },
  { key: "NEEDS_ACTION", label: "تحتاج إجراء" },
  { key: "PREPARING", label: "قيد التجهيز" },
  { key: "HANDOFF", label: "التسليم" },
  { key: "CLOSED", label: "مغلقة" },
] as const;

type QueueFilter = (typeof queueFilters)[number]["key"];
type OrderQueue = Exclude<QueueFilter, "ALL">;

function queueForOrder(order: Order): OrderQueue {
  if (order.state === "CREATED") return "NEEDS_ACTION";
  if (order.state === "PARTNER_ACCEPTED" || order.state === "PREPARING") return "PREPARING";
  if (order.state === "READY_FOR_DISPATCH" || order.state === "CAPTAIN_ASSIGNED" || order.state === "IN_CUSTODY") return "HANDOFF";
  return "CLOSED";
}

function matchesQuery(order: Order, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  const searchableText = [
    order.id,
    order.addressText,
    ...order.lines.flatMap((line) => [line.productName, line.variantTitle]),
  ].join(" ").toLocaleLowerCase();
  return searchableText.includes(normalizedQuery);
}

export function OrderManagement({ storeId }: { storeId: string }) {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([]);
  const [assignments, setAssignments] = useState<Readonly<Record<string, CaptainAssignment>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

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

  const filteredOrders = useMemo(() => orders.filter((order) => (filter === "ALL" || queueForOrder(order) === filter) && matchesQuery(order, searchQuery)), [filter, orders, searchQuery]);
  const queueCounts = useMemo(() => Object.fromEntries(queueFilters.map(({ key }) => [key, key === "ALL" ? orders.length : orders.filter((order) => queueForOrder(order) === key).length])) as Record<QueueFilter, number>, [orders]);

  async function transition(order: Order, requestedState = nextState(order)) {
    if (!requestedState || busy || loading) return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().transitionStoreOrder(token, storeId, order.id, { state: requestedState }, order.version); await load(); }
    catch (cause) { console.error("DSH order transition failed", cause); setError("تعذر تحديث حالة الطلب. أعد القراءة ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  async function confirmHandoff(order: Order, assignment: CaptainAssignment) {
    if (busy || loading || assignment.handoff.state !== "pending") return;
    setBusy(order.id); setError("");
    try { const token = await getUsableIdentityAccessToken(); await client().confirmCaptainStoreHandoff(token, storeId, order.id, assignment.id, assignment.handoff.version); await load(); }
    catch (cause) { console.error("DSH Captain handoff failed", cause); setError("تعذر تأكيد جاهزية التسليم. أعد القراءة ثم حاول مرة أخرى."); }
    finally { setBusy(""); }
  }

  return (
    <View style={styles.container} accessibilityLabel="إدارة طلبات المتجر">
      <Text style={styles.title}>طلبات المتجر</Text>
      <Text style={styles.muted}>تابع الطلبات حسب ما يحتاج إجراءً الآن، ثم افتح تفاصيل المنتجات عند الحاجة.</Text>

      {!loading && orders.length ? (
        <View style={styles.summaryRow} accessibilityLabel="ملخص طابور الطلبات">
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{queueCounts.ALL}</Text><Text style={styles.summaryLabel}>كل الطلبات</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{queueCounts.NEEDS_ACTION}</Text><Text style={styles.summaryLabel}>تحتاج إجراء</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{queueCounts.HANDOFF}</Text><Text style={styles.summaryLabel}>التسليم</Text></View>
        </View>
      ) : null}

      <BthwaniSearchField accessibilityLabel="البحث في طلبات المتجر" editable={!loading && !busy} onChangeText={setSearchQuery} onClear={() => setSearchQuery("")} placeholder="ابحث برقم الطلب أو العنوان أو المنتج" value={searchQuery} />
      <View style={styles.filterRow} accessibilityLabel="تصفية طلبات المتجر">
        {queueFilters.map(({ key, label }) => <BthwaniChip key={key} disabled={loading || Boolean(busy)} label={`${label} (${queueCounts[key]})`} onPress={() => setFilter(key)} selected={filter === key} />)}
      </View>

      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة طلبات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الطلبات…</Text></View> : null}
      {!loading && !orders.length ? <Text style={styles.muted}>لا توجد طلبات جديدة.</Text> : null}
      {!loading && orders.length > 0 && !filteredOrders.length ? <View style={styles.state}><Text style={styles.muted}>لا توجد طلبات مطابقة لهذا البحث أو التصنيف.</Text><BthwaniButton disabled={Boolean(busy)} label="عرض كل الطلبات" onPress={() => { setFilter("ALL"); setSearchQuery(""); }} variant="secondary" /></View> : null}

      {filteredOrders.map((order) => {
        const next = nextState(order);
        const assignment = assignments[order.id];
        const actionDisabled = loading || Boolean(busy);
        return (
          <View key={order.id} style={styles.order}>
            <View style={styles.orderHeader}>
              <View style={styles.orderHeaderCopy}>
                <Text style={styles.orderTitle}>طلب بتاريخ {formatOrderDate(order.createdAt)}</Text>
                <Text style={styles.muted}>{order.lines.length} منتج · {formatMoney(order.totalAmountMinor, order.currency)}</Text>
              </View>
              <BthwaniStatusBadge icon={order.state === "REJECTED" ? "warning" : order.state === "READY_FOR_DISPATCH" ? "success" : "orders"} label={orderStateLabel(order.state)} tone={order.state === "REJECTED" ? "danger" : order.state === "READY_FOR_DISPATCH" ? "success" : "info"} />
            </View>
            <Text style={styles.muted}>العنوان: {order.addressText}</Text>
            <View style={styles.lines}>
              {order.lines.map((line) => <View key={line.id} style={styles.line}><Text style={styles.lineTitle}>{line.productName} · {line.variantTitle}</Text><Text style={styles.muted}>المطلوب: {formatQuantity(line.baseUnit, line.requestedQuantityBaseUnits)} · النهائي: {formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)}</Text><Text style={styles.muted}>{pricingBasisLabel(line.pricingBasis)} · {formatMoney(line.lineAmountMinor, line.currency)}{line.modifierAmountMinor > 0 ? ` · الإضافات: ${formatMoney(line.modifierAmountMinor, line.currency)}` : ""}</Text>{line.modifierSnapshots.length ? <Text style={styles.muted}>الإضافات المحددة: {line.modifierSnapshots.map((modifier) => modifier.optionNameAr).join("، ")}</Text> : null}{line.attributeSnapshots.length ? <Text style={styles.muted}>تفاصيل المنتج: {line.attributeSnapshots.map((attribute) => `${attribute.code}: ${attributeSnapshotValue(attribute)}`).join("، ")}</Text> : null}</View>)}
            </View>
            {assignment ? <View style={styles.handoff}><BthwaniStatusBadge icon={assignment.handoff.state === "completed" ? "success" : "deliveries"} label={`تسليم المتجر: ${captainHandoffStateLabel(assignment.handoff.state)}`} tone={assignment.handoff.state === "completed" ? "success" : "warning"} />{assignment.handoff.state === "pending" ? <BthwaniButton busy={busy === order.id} disabled={actionDisabled} label="تأكيد جاهزية التسليم" onPress={() => void confirmHandoff(order, assignment)} /> : null}</View> : null}
            {next ? <View style={styles.actionRow}><BthwaniButton busy={busy === order.id} disabled={actionDisabled} label={next === "PARTNER_ACCEPTED" ? "قبول الطلب" : next === "PREPARING" ? "بدء التجهيز" : "جاهز للتسليم"} onPress={() => void transition(order)} style={styles.actionButton} />{next === "PARTNER_ACCEPTED" ? <BthwaniButton disabled={actionDisabled} label="رفض الطلب" onPress={() => void transition(order, "REJECTED")} style={styles.actionButton} variant="danger" /> : null}</View> : null}
          </View>
        );
      })}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={loading || Boolean(busy)} disabled={loading || Boolean(busy)} label="تحديث الطلبات" onPress={() => void load()} variant="secondary" />
    </View>
  );
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
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%" },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    summaryRow: { flexDirection: "row-reverse", gap: spacing[2] },
    summaryCard: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, flex: 1, gap: spacing[1], padding: spacing[2] },
    summaryValue: { ...typography.titleSm, color: theme.actionBackground },
    summaryLabel: { ...typography.label, color: theme.colorMuted, textAlign: "center" },
    filterRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing[1] },
    order: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2] },
    lines: { gap: spacing[2], marginTop: spacing[1] },
    line: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[1], paddingTop: spacing[2] },
    lineTitle: { ...typography.bodyStrong, color: theme.color },
    handoff: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], marginTop: spacing[1], padding: spacing[2] },
    actionRow: { flexDirection: "row", gap: spacing[2] },
    orderTitle: { ...typography.bodyStrong, color: theme.color },
    orderHeaderCopy: { flex: 1, gap: spacing[1] },
    orderHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
    actionButton: { flex: 1 },
    error: { ...typography.label, color: theme.danger },
  });
}
