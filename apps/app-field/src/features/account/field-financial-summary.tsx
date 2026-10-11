import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type FieldFinancialSummary, formatMoney } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "../field-operations/field-client";

export function FieldFinancialSummaryCard({ refreshVersion }: Readonly<{ refreshVersion: number }>) {
  const theme = useAppearanceTheme();
  const styles = createStyles(theme);
  const [summary, setSummary] = useState<FieldFinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      setSummary((await fieldClient().readOwnFieldFinancialSummary(token)).summary);
    } catch (cause) {
      console.warn("DSH Field financial summary readback failed", cause);
      setError("تعذر قراءة ملخص المكافآت.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void refreshVersion; void load(); }, [load, refreshVersion]));

  return <BthwaniSurface tone="base" style={styles.card}>
    <Text style={styles.title}>مكافآت المتاجر</Text>
    {loading ? <Text style={styles.muted}>{summary ? "جارٍ تحديث الملخص…" : "جارٍ تحميل الملخص…"}</Text> : null}
    {summary ? <View style={styles.metrics}>
      <View style={styles.primaryMetric}><Text style={styles.label}>إجمالي المكافآت</Text><Text style={styles.primaryValue}>{formatMoney(summary.earnedMinor, summary.currency)}</Text></View>
      <View style={styles.metric}><Text style={styles.label}>متاجر مستحقة</Text><Text style={styles.value}>{summary.partnerCount.toLocaleString("ar-YE")}</Text></View>
      {summary.partnerCount === 0 && summary.earnedMinor === 0 ? <Text style={styles.muted}>ملفات الضم ليست مكافآت مستحقة. تُحتسب المكافأة بعد ظهور أول متجر مؤهل للعميل مع وجود سياسة استحقاق فعّالة.</Text> : null}
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    title: { ...typography.titleMd, color: theme.color },
    metrics: { gap: spacing[3] },
    primaryMetric: { gap: spacing[1] },
    primaryValue: { ...typography.titleMd, color: theme.color },
    metric: { gap: spacing[1] },
    label: { ...typography.caption, color: theme.colorMuted },
    value: { ...typography.bodyStrong, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    error: { ...typography.bodySm, color: theme.warning },
  });
}
