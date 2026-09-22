import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { useCallback, useEffect, useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import { formatMoney, type FieldFinancialSummary } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "../field-operations/field-client";

export function FieldFinancialSummaryCard() {
  const theme = useAppearanceTheme();
  const styles = createStyles(theme);
  const [summary, setSummary] = useState<FieldFinancialSummary | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const token = await getUsableIdentityAccessToken();
      setSummary((await fieldClient().readOwnFieldFinancialSummary(token)).summary);
      setError("");
    } catch (cause) {
      console.error("DSH Field financial summary readback failed", cause);
      setError("تعذر قراءة محفظة الميداني الآن.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <BthwaniSurface tone="base" style={styles.card}><Text style={styles.eyebrow}>المحفظة المستحقة</Text><Text style={styles.title}>مكافآت الميداني</Text>{summary ? <View style={styles.grid}><View><Text style={styles.label}>المتاح المكتسب</Text><Text style={styles.value}>{formatMoney(summary.earnedMinor, summary.currency)}</Text></View><View><Text style={styles.label}>المتاجر المكتملة</Text><Text style={styles.value}>{summary.storeCount.toLocaleString("ar-YE")}</Text></View></View> : error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : <Text style={styles.muted}>جارٍ قراءة الاستحقاق…</Text>}<Text style={styles.muted}>تُثبت المكافأة بعد نشر متجر الشريك وظهوره للعميل، ولا تتأثر بإخفائه لاحقًا.</Text></BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    eyebrow: { ...typography.caption, color: theme.interactiveText },
    title: { ...typography.titleMd, color: theme.color },
    grid: { flexDirection: "row", gap: spacing[5] },
    label: { ...typography.caption, color: theme.colorMuted },
    value: { ...typography.bodyStrong, color: theme.color, marginTop: spacing[1] },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    error: { ...typography.bodySm, color: theme.warning },
  });
}
