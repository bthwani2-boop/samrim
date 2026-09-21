import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, settlementPeriodLabel, type PartnerFinancialSummary } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() { const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim(); if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED"); return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() }); }

export function PartnerFinancialSummaryCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [summary, setSummary] = useState<PartnerFinancialSummary | null>(null);
  const [loading, setLoading] = useState(authenticated);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      setSummary((await client().readOwnPartnerFinancialSummary(token)).summary);
    } catch (cause) {
      console.error("DSH partner financial summary readback failed", cause);
      setError("تعذر قراءة مستحقات الشريك. أعد المحاولة.");
    } finally { setLoading(false); }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);
  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="مستحقات الشريك"><View style={styles.header}><View><Text style={styles.eyebrow}>ملخص مالي</Text><Text style={styles.title}>المستحقات المالية</Text></View>{summary ? <Text style={styles.period}>{settlementPeriodLabel(summary.settlementPeriod)}</Text> : null}</View>{loading ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المستحقات…</Text></View> : null}{!loading && summary ? <><View style={styles.metrics}><View><Text style={styles.metricLabel}>صافي المستحق</Text><Text style={styles.metricValue}>{formatMoney(summary.earnedMinor, summary.currency)}</Text></View><View><Text style={styles.metricLabel}>عمولة المنصة</Text><Text style={styles.metricValue}>{formatMoney(summary.commissionMinor, summary.currency)}</Text></View><View><Text style={styles.metricLabel}>الطلبات المسلّمة</Text><Text style={styles.metricValue}>{summary.orderCount.toLocaleString("ar-YE")}</Text></View></View><Text style={styles.muted}>الفترة المعتمدة للتسوية: {settlementPeriodLabel(summary.settlementPeriod)}. تُشتق الأرقام من الطلبات المسلّمة والسجل المالي الكانوني، ولا تُعدّل من التطبيق.</Text></> : null}{!loading && !summary && !error ? <Text style={styles.muted}>لا توجد مستحقات مسجلة بعد.</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{authenticated ? <BthwaniButton busy={loading} label="تحديث المستحقات" onPress={() => void load()} variant="secondary" /> : null}</BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.titleSm, color: theme.color }, period: { ...typography.label, color: theme.interactiveText }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, metrics: { gap: spacing[3] }, metricLabel: { ...typography.caption, color: theme.colorMuted }, metricValue: { ...typography.titleMd, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, error: { ...typography.bodySm, color: theme.warning } }); }
