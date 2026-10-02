import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { useCallback, useEffect, useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import { formatMoney, type FieldAcquisitionEntitlementPage, type FieldFinancialSummary } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "../field-operations/field-client";

export function FieldFinancialSummaryCard() {
  const theme = useAppearanceTheme();
  const styles = createStyles(theme);
  const [summary, setSummary] = useState<FieldFinancialSummary | null>(null);
  const [ledger, setLedger] = useState<FieldAcquisitionEntitlementPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (cursor = "", append = false) => {
    if (append) setLoadingMore(true);
    try {
      const token = await getUsableIdentityAccessToken();
      const [financial, entries] = await Promise.all([
        fieldClient().readOwnFieldFinancialSummary(token),
        fieldClient().listOwnFieldAcquisitionEntitlements(token, 50, cursor),
      ]);
      setSummary(financial.summary);
      setLedger((current) => append && current ? { entitlements: [...current.entitlements, ...entries.entitlements], ...(entries.nextCursor ? { nextCursor: entries.nextCursor } : {}) } : entries);
      setError("");
    } catch (cause) {
      console.error("DSH Field financial summary readback failed", cause);
      setError("تعذر قراءة محفظة الميداني الآن.");
    } finally {
      setLoadingMore(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const entitlementRows = ledger?.entitlements.map((entry) => <View key={entry.ledgerTransactionId} style={styles.entry}>
    <View style={styles.entryMain}>
      <Text style={styles.value}>+{formatMoney(entry.rewardMinor, entry.currency)}</Text>
      <Text style={styles.label}>استحقاق ضم شريك · {entry.storeName}</Text>
      <Text style={styles.muted}>تحقق بنشر المتجر وظهوره للعميل · {new Date(entry.createdAt).toLocaleDateString("ar-YE")}</Text>
    </View>
    <Text accessibilityLabel={`معرّف الحركة ${entry.ledgerTransactionId}`} style={styles.transactionID}>{entry.ledgerTransactionId}</Text>
  </View>);
  return <BthwaniSurface tone="base" style={styles.card}>
    <Text style={styles.eyebrow}>المحفظة والاستحقاقات</Text>
    <Text style={styles.title}>استحقاق ضم الشريك</Text>
    {summary ? <View style={styles.grid}>
      <View><Text style={styles.label}>إجمالي ما أودع في المحفظة</Text><Text style={styles.value}>{formatMoney(summary.earnedMinor, summary.currency)}</Text></View>
      <View><Text style={styles.label}>شركاء تحقق استحقاقهم</Text><Text style={styles.value}>{summary.partnerCount.toLocaleString("ar-YE")}</Text></View>
      <View><Text style={styles.label}>إجمالي الاستحقاقات</Text><Text style={styles.value}>{formatMoney(summary.entitlementMinor, summary.currency)}</Text></View>
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!summary || !ledger ? <Text style={styles.muted}>جارٍ قراءة سجل المحفظة من WLT…</Text> : null}
    <Text style={styles.muted}>يُثبت الاستحقاق بعد ظهور متجر الشريك للعميل؛ الرصيد المتاح والمحجوز يظهران في قسم التسوية.</Text>
    <Text style={styles.sectionTitle}>حركات استحقاق ضم الشريك</Text>
    {entitlementRows}
    {ledger?.entitlements.length === 0 ? <Text style={styles.muted}>لا توجد حركات استحقاق مسجلة حتى الآن.</Text> : null}
    {ledger?.nextCursor ? <BthwaniButton busy={loadingMore} label="عرض الحركات الأقدم" onPress={() => void load(ledger.nextCursor, true)} variant="secondary" /> : null}
    <BthwaniButton busy={loadingMore} label="تحديث السجل" onPress={() => void load()} variant="secondary" />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    eyebrow: { ...typography.caption, color: theme.interactiveText },
    title: { ...typography.titleMd, color: theme.color },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, marginTop: spacing[2] },
    grid: { flexDirection: "row", gap: spacing[5] },
    entry: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", paddingVertical: spacing[3] },
    entryMain: { flex: 1, gap: spacing[1] },
    transactionID: { ...typography.caption, color: theme.colorMuted, maxWidth: 110 },
    label: { ...typography.caption, color: theme.colorMuted },
    value: { ...typography.bodyStrong, color: theme.color, marginTop: spacing[1] },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    error: { ...typography.bodySm, color: theme.warning },
  });
}
