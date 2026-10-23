import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, settlementPeriodLabel, type PartnerScopedFinancialSummary } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

export function PartnerFinancialSummaryCard() {
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

  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="ملخص مستحقات الشريك">
    <View style={styles.header}>
      <View style={styles.headerText}><Text style={styles.label}>المبلغ المؤهل للصرف</Text>
        {loading && !summary ? <ActivityIndicator color={theme.actionBackground} /> : null}
        {summary ? <Text style={styles.balance}>{formatMoney(summary.eligibleAvailableMinor, summary.currency)}</Text> : <Text style={styles.balance}>—</Text>}
        <Text style={styles.muted}>مستحقات قابلة لطلب الصرف وفق سياسة المتاجر</Text>
      </View>
      <View style={styles.icon}><BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[8]} /></View>
    </View>
    {summary ? <>
      <View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.label}>مبالغ محجوزة</Text><Text style={styles.value}>{formatMoney(summary.heldMinor, summary.currency)}</Text></View>
        <View style={styles.metric}><Text style={styles.label}>تم صرفه سابقًا</Text><Text style={styles.value}>{formatMoney(summary.settledMinor, summary.currency)}</Text></View>
      </View>
      {summary.ownerCommissionReceivableMinor !== undefined ? <View style={styles.commissionRow}>
        <Text style={styles.muted}>ذمة عمولة المنصة</Text>
        <Text style={styles.value}>{formatMoney(summary.ownerCommissionReceivableMinor, summary.currency)}</Text>
      </View> : null}
      {!summary.attributionComplete ? <Text style={styles.error}>بعض التحويلات القديمة غير مكتملة النسبة للمتاجر؛ الصرف الجديد يتطلب اكتمال المطابقة.</Text> : null}
      {summary.stores.length > 0 ? <View style={styles.stores}>
        <Text style={styles.sectionTitle}>مستحقات المتاجر</Text>
        {summary.stores.slice(0, showDetails ? undefined : 3).map((store) => <View key={store.storeId} style={styles.store}>
          <View style={styles.storeTop}><Text style={styles.storeName} numberOfLines={1}>{store.storeName}</Text>
            <Text style={styles.storeAmount}>{formatMoney(store.eligibleAvailableMinor, store.currency)}</Text></View>
          <Text style={styles.muted}>المحجوز: {formatMoney(store.heldMinor, store.currency)} · {settlementPeriodLabel(store.settlementPeriod)}</Text>
          {showDetails ? <Text style={styles.muted}>المكتسب: {formatMoney(store.earnedMinor, store.currency)} · العمولة: {formatMoney(store.commissionMinor, store.currency)} · المصروف: {formatMoney(store.settledMinor, store.currency)} · {store.orderCount.toLocaleString("ar-YE")} طلب</Text> : null}
        </View>)}
        <BthwaniButton label={showDetails ? "تفاصيل أقل" : "عرض تفاصيل المستحقات"} variant="secondary" onPress={() => setShowDetails((value) => !value)} />
      </View> : null}
    </> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  card: { borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[4], padding: spacing[4] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  headerText: { flex: 1, gap: spacing[2], minWidth: 0 },
  icon: { backgroundColor: theme.actionSoft, width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.lg },
  balance: { ...typography.hero, color: theme.color, textAlign: "right" },
  metrics: { flexDirection: "row", gap: spacing[2] },
  metric: { flex: 1, minWidth: 0, padding: spacing[3], backgroundColor: theme.surfaceRaised, borderRadius: radius.md, gap: spacing[2] },
  commissionRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing[2], alignItems: "center" },
  label: { ...typography.caption, color: theme.colorMuted },
  value: { ...typography.bodyStrong, color: theme.color },
  muted: { ...typography.caption, color: theme.colorMuted },
  error: { ...typography.bodySm, color: theme.warning },
  stores: { gap: spacing[2] },
  sectionTitle: { ...typography.titleSm, color: theme.color },
  store: { gap: spacing[1], padding: spacing[3], backgroundColor: theme.surfaceRaised, borderRadius: radius.md },
  storeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing[2] },
  storeName: { ...typography.bodyStrong, color: theme.color, flex: 1 },
  storeAmount: { ...typography.bodyStrong, color: theme.interactiveText },
}); }
