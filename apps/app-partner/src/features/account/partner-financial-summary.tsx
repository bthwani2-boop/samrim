import { type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, settlementPeriodLabel, type PartnerScopedFinancialSummary } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

export function PartnerFinancialSummaryCard({ actions, workflow }: { actions?: ReactNode; workflow?: ReactNode }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [summary, setSummary] = useState<PartnerScopedFinancialSummary | null>(null);
  const [loading, setLoading] = useState(authenticated);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      setSummary((await client().readOwnPartnerFinancialSummary(token)).summary);
    } catch (cause) {
      setSummary(null);
      console.error("DSH partner financial summary readback failed", cause);
      setError("تعذر قراءة المستحقات. أعد المحاولة.");
    } finally { setLoading(false); }
  }, [authenticated]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <View style={styles.container} accessibilityLabel="ملخص مستحقات الشريك">
    <View style={styles.balanceCard}>
      <View style={styles.balanceCopy}><View style={styles.availableTitle}><View style={[styles.dot, { backgroundColor: theme.success }]} /><Text style={styles.balanceLabel}>الرصيد المتاح للصرف</Text></View>
        {loading && !summary ? <ActivityIndicator color={theme.color} /> : null}
        <Text style={styles.balance}>{summary ? formatMoney(summary.eligibleAvailableMinor, summary.currency) : "—"}</Text>
      </View>
      <View style={styles.moneyIcon}><BthwaniIcon name="wallet" color={theme.color} size={27} /></View>
    </View>
    {summary ? <>
      <View style={styles.metrics}>
        <View style={styles.metric}><BthwaniIcon name="wallet" color={theme.info} size={22} /><Text style={styles.metricLabel}>المحجوز</Text><Text style={styles.metricValue}>{formatMoney(summary.heldMinor, summary.currency)}</Text></View>
        <View style={styles.metric}><BthwaniIcon name="orders" color={theme.success} size={22} /><Text style={styles.metricLabel}>المصروف سابقًا</Text><Text style={styles.metricValue}>{formatMoney(summary.settledMinor, summary.currency)}</Text></View>
        {summary.ownerCommissionReceivableMinor !== undefined ? <View style={styles.metric}><BthwaniIcon name="offers" color={theme.warning} size={22} /><Text style={styles.metricLabel}>ذمة العمولة</Text><Text style={styles.metricValue}>{formatMoney(summary.ownerCommissionReceivableMinor, summary.currency)}</Text></View> : null}
      </View>
    </> : null}
    {actions}
    {workflow}
    {summary ? <>
      {!summary.attributionComplete ? <Text style={styles.error}>بعض التحويلات القديمة غير مكتملة النسبة للمتاجر؛ الصرف الجديد يتطلب اكتمال المطابقة.</Text> : null}
      <View style={styles.infoCard}><Text style={styles.infoTitle}>المتاح للصرف اليوم</Text><Text style={styles.muted}>المبلغ المؤهل للصرف هو {formatMoney(summary.eligibleAvailableMinor, summary.currency)}، ولا يشمل المبالغ المحجوزة أو غير المؤهلة حسب سياسة التسوية.</Text></View>
      {summary.stores.length > 0 ? <View style={styles.stores}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>تفاصيل المتاجر</Text><BthwaniIcon name="store" size={24} color={theme.brandAction} /></View>
        {summary.stores.slice(0, showDetails ? undefined : 2).map((store) => <View key={store.storeId} style={styles.store}>
          <View style={styles.storeTop}><Text style={styles.storeAmount}>{formatMoney(store.eligibleAvailableMinor, store.currency)}</Text><Text style={styles.storeName} numberOfLines={1}>{store.storeName}</Text></View>
          <Text style={styles.muted}>المحجوز: {formatMoney(store.heldMinor, store.currency)} · {settlementPeriodLabel(store.settlementPeriod)}</Text>
          {showDetails ? <Text style={styles.muted}>المكتسب: {formatMoney(store.earnedMinor, store.currency)} · العمولة: {formatMoney(store.commissionMinor, store.currency)} · المصروف: {formatMoney(store.settledMinor, store.currency)} · {store.orderCount.toLocaleString("ar-YE")} طلب</Text> : null}
        </View>)}
        <Pressable accessibilityRole="button" accessibilityLabel={showDetails ? "إخفاء تفاصيل المتاجر" : "تفاصيل المتاجر"} onPress={() => setShowDetails((value) => !value)} style={styles.detailsButton}><Text style={styles.detailsLabel}>{showDetails ? "تفاصيل أقل" : "عرض تفاصيل المستحقات"}</Text></Pressable>
      </View> : null}
    </> : null}
    {error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.infoCard}><Text accessibilityRole="alert" style={styles.error}>{error} · إعادة المحاولة</Text></Pressable> : null}
  </View>;
}
function createStyles(p: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  container: { gap: spacing[3] },
  balanceCard: { flexDirection: "row", alignItems: "center", minHeight: 154, borderRadius: 20, padding: 17, gap: 16, backgroundColor: p.actionSoft, borderWidth: 1, borderColor: p.brandAction },
  moneyIcon: { width: 57, height: 57, borderRadius: 16, backgroundColor: p.actionSoft, alignItems: "center", justifyContent: "center" },
  balanceCopy: { flex: 1, alignItems: "flex-start", gap: 6 },
  availableTitle: { flexDirection: "row", gap: 8, alignItems: "center" },
  dot: { height: 10, width: 10, borderRadius: 5 },
  balanceLabel: { ...typography.bodyStrong, color: p.color },
  balance: { color: p.color, fontSize: 29, fontWeight: "800", writingDirection: "rtl" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { flexGrow: 1, flexBasis: 95, gap: 5, backgroundColor: p.surface, borderColor: p.borderColor, borderWidth: 1, borderRadius: 14, padding: 11, alignItems: "flex-end" },
  metricLabel: { ...typography.caption, color: p.colorMuted },
  metricValue: { ...typography.bodyStrong, color: p.color },
  infoCard: { backgroundColor: p.surfaceRaised, borderColor: p.borderColor, borderWidth: 1, borderRadius: 16, padding: 14, gap: 6 },
  infoTitle: { ...typography.bodyStrong, color: p.color },
  muted: { ...typography.caption, color: p.colorMuted },
  error: { ...typography.bodySm, color: p.warning },
  stores: { backgroundColor: p.surface, borderColor: p.borderColor, borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 },
  sectionHeader: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 9 },
  sectionTitle: { ...typography.titleSm, color: p.color },
  store: { backgroundColor: p.surfaceRaised, borderRadius: 12, padding: 12, gap: 5 },
  storeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  storeName: { ...typography.bodyStrong, color: p.color },
  storeAmount: { ...typography.bodyStrong, color: p.success },
  detailsButton: { minHeight: 38, justifyContent: "center", alignItems: "center", borderRadius: 11, borderColor: p.borderColor, borderWidth: 1 },
  detailsLabel: { ...typography.label, color: p.color },
}); }
