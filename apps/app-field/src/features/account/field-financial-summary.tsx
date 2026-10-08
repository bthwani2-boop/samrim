import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import { formatMoney, type FieldAcquisitionEntitlementPage, type FieldFinancialSummary } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "../field-operations/field-client";

export function FieldFinancialSummaryCard() {
  const theme = useAppearanceTheme();
  const styles = createStyles(theme);
  const [summary, setSummary] = useState<FieldFinancialSummary | null>(null);
  const [ledger, setLedger] = useState<FieldAcquisitionEntitlementPage | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [ledgerError, setLedgerError] = useState("");

  const load = useCallback(async () => {
    setSummaryLoading(true);
    setLedgerLoading(true);
    setSummaryError("");
    setLedgerError("");

    let token: string;
    try {
      token = await getUsableIdentityAccessToken();
    } catch (cause) {
      console.warn("Field financial identity token read failed", cause);
      setSummaryError("تعذر التحقق من حسابك لقراءة المستحقات.");
      setLedgerError("تعذر التحقق من حسابك لقراءة الحركات.");
      setSummaryLoading(false);
      setLedgerLoading(false);
      return;
    }

    const [financialResult, ledgerResult] = await Promise.allSettled([
      fieldClient().readOwnFieldFinancialSummary(token),
      fieldClient().listOwnFieldAcquisitionEntitlements(token, 50),
    ]);

    if (financialResult.status === "fulfilled") {
      setSummary(financialResult.value.summary);
    } else {
      console.warn("DSH Field financial summary readback failed", financialResult.reason);
      setSummaryError("تعذر قراءة ملخص مستحقاتك الآن.");
    }
    if (ledgerResult.status === "fulfilled") {
      setLedger(ledgerResult.value);
    } else {
      console.warn("DSH Field acquisition entitlement readback failed", ledgerResult.reason);
      setLedgerError("تعذر قراءة حركات مكافآت الشركاء الآن.");
    }
    setSummaryLoading(false);
    setLedgerLoading(false);
  }, []);

  const loadMore = useCallback(async () => {
    if (!ledger?.nextCursor || loadingMore || ledgerLoading) return;
    setLoadingMore(true);
    setLedgerError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const nextPage = await fieldClient().listOwnFieldAcquisitionEntitlements(token, 50, ledger.nextCursor);
      setLedger((current) => {
        if (!current) return nextPage;
        const knownIDs = new Set(current.entitlements.map((entry) => entry.ledgerTransactionId));
        return {
          entitlements: [...current.entitlements, ...nextPage.entitlements.filter((entry) => !knownIDs.has(entry.ledgerTransactionId))],
          ...(nextPage.nextCursor ? { nextCursor: nextPage.nextCursor } : {}),
        };
      });
    } catch (cause) {
      console.warn("DSH Field acquisition entitlement continuation readback failed", cause);
      setLedgerError("تعذر تحميل الحركات الأقدم. أعد المحاولة.");
    } finally {
      setLoadingMore(false);
    }
  }, [ledger?.nextCursor, ledgerLoading, loadingMore]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const entitlementRows = ledger?.entitlements.map((entry) => <View key={entry.ledgerTransactionId} style={styles.entry}>
    <View style={styles.entryMain}>
      <Text style={styles.value}>+{formatMoney(entry.rewardMinor, entry.currency)}</Text>
      <Text style={styles.label}>استحقاق ضم شريك · {entry.storeName}</Text>
      <Text style={styles.muted}>تحقق بنشر المتجر وظهوره للعميل · {new Date(entry.createdAt).toLocaleDateString("ar-YE")}</Text>
    </View>
  </View>);

  return <BthwaniSurface tone="base" style={styles.card}>
    <Text style={styles.eyebrow}>المحفظة والاستحقاقات</Text>
    <Text style={styles.title}>استحقاق ضم الشريك</Text>
    {summary ? <View style={styles.grid}>
      <View style={styles.metric}><Text style={styles.label}>إجمالي ما أودع في المحفظة</Text><Text style={styles.value}>{formatMoney(summary.earnedMinor, summary.currency)}</Text></View>
      <View style={styles.metric}><Text style={styles.label}>شركاء تحقق استحقاقهم</Text><Text style={styles.value}>{summary.partnerCount.toLocaleString("ar-YE")}</Text></View>
      <View style={styles.metric}><Text style={styles.label}>إجمالي الاستحقاقات</Text><Text style={styles.value}>{formatMoney(summary.entitlementMinor, summary.currency)}</Text></View>
    </View> : null}
    {summaryLoading && !summary ? <Text style={styles.muted}>جارٍ قراءة ملخص المستحقات…</Text> : null}
    {summaryError ? <Text accessibilityRole="alert" style={styles.error}>{summaryError}</Text> : null}
    <Text style={styles.muted}>يُثبت الاستحقاق بعد ظهور متجر الشريك للعميل؛ الرصيد المتاح والمحجوز يظهران في قسم التسوية.</Text>
    <Text style={styles.sectionTitle}>حركات استحقاق ضم الشريك</Text>
    {ledgerLoading && !ledger ? <Text style={styles.muted}>جارٍ قراءة سجل المكافآت…</Text> : null}
    {ledgerError ? <Text accessibilityRole="alert" style={styles.error}>{ledgerError}</Text> : null}
    {entitlementRows}
    {ledger && ledger.entitlements.length === 0 ? <Text style={styles.muted}>لا توجد حركات استحقاق مسجلة حتى الآن.</Text> : null}
    {ledger?.nextCursor ? <BthwaniButton busy={loadingMore} label="عرض الحركات الأقدم" onPress={() => void loadMore()} variant="secondary" /> : null}
    <BthwaniButton busy={summaryLoading || ledgerLoading} label="تحديث السجل" onPress={() => void load()} variant="secondary" />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    eyebrow: { ...typography.caption, color: theme.interactiveText },
    title: { ...typography.titleMd, color: theme.color },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, marginTop: spacing[2] },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] },
    metric: { flexBasis: 136, flexGrow: 1, minWidth: 0 },
    entry: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", paddingVertical: spacing[3] },
    entryMain: { flex: 1, gap: spacing[1] },
    label: { ...typography.caption, color: theme.colorMuted },
    value: { ...typography.bodyStrong, color: theme.color, marginTop: spacing[1] },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    error: { ...typography.bodySm, color: theme.warning },
  });
}
