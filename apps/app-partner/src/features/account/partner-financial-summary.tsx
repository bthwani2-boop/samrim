import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, settlementPeriodLabel, type PartnerScopedFinancialSummary } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() { const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim(); if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED"); return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() }); }

export function PartnerFinancialSummaryCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [summary, setSummary] = useState<PartnerScopedFinancialSummary | null>(null);
  const [loading, setLoading] = useState(authenticated);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      setSummary((await client().readOwnPartnerFinancialSummary(token)).summary);
    } catch (cause) {
      setSummary(null);
      console.error("DSH partner financial summary readback failed", cause);
      setError("تعذر قراءة مستحقات الشريك. أعد المحاولة.");
    } finally { setLoading(false); }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);
  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="مستحقات الشريك">
    <View style={styles.header}><Text style={styles.title}>المستحقات المالية للمتاجر المصرح بها</Text></View>
    {loading ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المستحقات…</Text></View> : null}
    {!loading && summary ? <>
      <Text style={styles.title}>المتاح: {formatMoney(summary.eligibleAvailableMinor, summary.currency)}</Text>
      <Text style={styles.muted}>المحجوز: {formatMoney(summary.heldMinor, summary.currency)} · المصروف: {formatMoney(summary.settledMinor, summary.currency)}</Text>
      {!summary.attributionComplete ? <Text style={styles.error}>بعض عمليات الصرف القديمة تحتاج مطابقة مع المتاجر. تفاصيل الحجز والصرف لكل متجر تعرض التوزيع المثبت فقط.</Text> : null}
      {summary.ownerCommissionReceivableMinor !== undefined ? <Text style={styles.muted}>ذمة العمولة على محفظتك: {formatMoney(summary.ownerCommissionReceivableMinor, summary.currency)}</Text> : null}
      {summary.stores.map((store) => <View key={store.storeId} style={styles.metrics}>
        <Text style={styles.title}>{store.storeName}</Text>
        <Text style={styles.muted}>المتاح: {formatMoney(store.eligibleAvailableMinor, store.currency)} · المحجوز: {formatMoney(store.heldMinor, store.currency)}</Text>
        <Text style={styles.muted}>المكتسب بعد تسويات العمولة: {formatMoney(store.earnedMinor, store.currency)} · العمولة: {formatMoney(store.commissionMinor, store.currency)}</Text>
        <Text style={styles.muted}>المصروف: {formatMoney(store.settledMinor, store.currency)} · {store.orderCount.toLocaleString("ar-YE")} طلب · {settlementPeriodLabel(store.settlementPeriod)}</Text>
      </View>)}
    </> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <BthwaniButton busy={loading} label="تحديث المستحقات" onPress={() => void load()} variant="secondary" />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.titleSm, color: theme.color }, period: { ...typography.label, color: theme.interactiveText }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, metrics: { gap: spacing[3] }, metricLabel: { ...typography.caption, color: theme.colorMuted }, metricValue: { ...typography.titleMd, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, error: { ...typography.bodySm, color: theme.warning } }); }
