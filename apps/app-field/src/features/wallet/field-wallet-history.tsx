import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { formatMoney, type FieldPayoutRequestHistoryPage, type FieldWalletHistoryPage } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "../field-operations/field-client";

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ar-YE");
}

function requestStatusLabel(status: string): string {
  switch (status) {
    case "HELD": return "محجوز للمراجعة";
    case "PREPARED": return "قيد تجهيز الصرف";
    case "APPROVED": return "معتمد للصرف";
    case "FROZEN": return "مجمّد للمراجعة";
    case "EXECUTED": return "تم تنفيذ الصرف";
    case "COMPLETED": return "اكتمل الصرف";
    case "CANCELLED": return "أُلغي الطلب";
    case "EXCEPTION": return "يحتاج إلى متابعة";
    default: return "حالة غير محددة";
  }
}

function movementTypeLabel(type: string): string {
  switch (type) {
    case "FIELD_ACQUISITION_ENTITLEMENT_POSTED": return "مكافأة ضم شريك";
    case "PAYOUT_COMPLETED": return "اكتمل الصرف";
    default: return "حركة محفظة";
  }
}

export function FieldWalletHistory({ refreshVersion }: Readonly<{ refreshVersion: number }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [walletPage, setWalletPage] = useState<FieldWalletHistoryPage | null>(null);
  const [payoutPage, setPayoutPage] = useState<FieldPayoutRequestHistoryPage | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [payoutLoading, setPayoutLoading] = useState(true);
  const [walletMoreLoading, setWalletMoreLoading] = useState(false);
  const [payoutMoreLoading, setPayoutMoreLoading] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [payoutError, setPayoutError] = useState("");

  const load = useCallback(async () => {
    setWalletLoading(true);
    setPayoutLoading(true);
    setWalletError("");
    setPayoutError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const [walletResult, payoutResult] = await Promise.allSettled([
        fieldClient().listOwnFieldWalletHistory(token, 50),
        fieldClient().listOwnFieldPayoutRequests(token, 50),
      ]);
      if (walletResult.status === "fulfilled") setWalletPage(walletResult.value);
      else {
        console.warn("DSH field wallet journal readback failed", walletResult.reason);
        setWalletError("تعذر تحميل سجل حركات المحفظة.");
      }
      if (payoutResult.status === "fulfilled") setPayoutPage(payoutResult.value);
      else {
        console.warn("DSH field payout request history readback failed", payoutResult.reason);
        setPayoutError("تعذر تحميل طلبات التسوية.");
      }
    } catch (cause) {
      console.warn("Field wallet history identity token read failed", cause);
      setWalletError("تعذر التحقق من الحساب لقراءة سجل المحفظة.");
      setPayoutError("تعذر التحقق من الحساب لقراءة طلبات التسوية.");
    } finally {
      setWalletLoading(false);
      setPayoutLoading(false);
    }
  }, [refreshVersion]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const loadMoreWallet = useCallback(async () => {
    const cursor = walletPage?.nextCursor;
    if (!cursor || walletMoreLoading) return;
    setWalletMoreLoading(true);
    setWalletError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const nextPage = await fieldClient().listOwnFieldWalletHistory(token, 50, cursor);
      setWalletPage((current) => current ? {
        ...nextPage,
        entries: [...current.entries, ...nextPage.entries],
        ...(nextPage.nextCursor ? { nextCursor: nextPage.nextCursor } : {}),
      } : nextPage);
    } catch (cause) {
      console.warn("DSH field wallet journal continuation readback failed", cause);
      setWalletError("تعذر تحميل الحركات الأقدم.");
    } finally {
      setWalletMoreLoading(false);
    }
  }, [walletMoreLoading, walletPage?.nextCursor]);

  const loadMorePayouts = useCallback(async () => {
    const cursor = payoutPage?.nextCursor;
    if (!cursor || payoutMoreLoading) return;
    setPayoutMoreLoading(true);
    setPayoutError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const nextPage = await fieldClient().listOwnFieldPayoutRequests(token, 50, cursor);
      setPayoutPage((current) => current ? {
        ...nextPage,
        requests: [...current.requests, ...nextPage.requests],
        ...(nextPage.nextCursor ? { nextCursor: nextPage.nextCursor } : {}),
      } : nextPage);
    } catch (cause) {
      console.warn("DSH field payout request history continuation readback failed", cause);
      setPayoutError("تعذر تحميل الطلبات الأقدم.");
    } finally {
      setPayoutMoreLoading(false);
    }
  }, [payoutMoreLoading, payoutPage?.nextCursor]);

  return <BthwaniSurface tone="base" style={styles.card}>
    <Text style={styles.title}>سجل المحفظة</Text>
    {walletLoading && !walletPage ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ تحميل الحركات…</Text></View> : null}
    {walletLoading && walletPage ? <Text style={styles.muted}>جارٍ تحديث الحركات…</Text> : null}
    {walletError ? <Text accessibilityRole="alert" style={styles.error}>{walletError}</Text> : null}
    {walletPage?.entries.map((entry, index) => {
      const credit = entry.direction === "CREDIT";
      return <View key={`${entry.createdAt}-${entry.type}-${index}`} style={styles.entry}>
        <View style={styles.entryMain}>
          <Text style={styles.value}>{credit ? "+" : "−"}{formatMoney(entry.amountMinor, entry.currency)}</Text>
          <Text style={styles.label}>{movementTypeLabel(entry.type)} · {credit ? "إضافة" : "خصم"}</Text>
          <Text style={styles.muted}>{dateLabel(entry.createdAt)}</Text>
        </View>
        <View style={styles.balance}>
          <Text style={styles.metricLabel}>الرصيد بعدها</Text>
          <Text style={styles.balanceValue}>{formatMoney(entry.balanceAfterMinor, entry.currency)}</Text>
        </View>
      </View>;
    })}
    {walletPage && walletPage.entries.length === 0 ? <Text style={styles.muted}>لا توجد حركات مسجلة.</Text> : null}
    {walletPage?.nextCursor ? <BthwaniButton busy={walletMoreLoading} label="عرض حركات أقدم" onPress={() => void loadMoreWallet()} variant="secondary" /> : null}

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>طلبات التسوية</Text>
      {payoutLoading && !payoutPage ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ تحميل الطلبات…</Text></View> : null}
      {payoutLoading && payoutPage ? <Text style={styles.muted}>جارٍ تحديث الطلبات…</Text> : null}
      {payoutError ? <Text accessibilityRole="alert" style={styles.error}>{payoutError}</Text> : null}
      {payoutPage?.requests.map((request, index) => <View key={`${request.createdAt}-${index}`} style={styles.request}>
        <View style={styles.entryMain}>
          <Text style={styles.value}>{formatMoney(request.amountMinor, request.currency)}</Text>
          <Text style={styles.label}>{requestStatusLabel(request.status)}</Text>
        </View>
        <Text style={styles.muted}>{dateLabel(request.createdAt)}</Text>
      </View>)}
      {payoutPage && payoutPage.requests.length === 0 ? <Text style={styles.muted}>لا توجد طلبات تسوية مسجلة.</Text> : null}
      {payoutPage?.nextCursor ? <BthwaniButton busy={payoutMoreLoading} label="عرض طلبات أقدم" onPress={() => void loadMorePayouts()} variant="secondary" /> : null}
    </View>
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    title: { ...typography.titleMd, color: theme.color },
    section: { borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[2], marginTop: spacing[2], paddingTop: spacing[3] },
    sectionTitle: { ...typography.bodyStrong, color: theme.color },
    entry: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", gap: spacing[2], justifyContent: "space-between", paddingVertical: spacing[3] },
    request: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", gap: spacing[2], justifyContent: "space-between", paddingVertical: spacing[3] },
    entryMain: { flex: 1, gap: spacing[1], minWidth: 0 },
    balance: { alignItems: "flex-end", gap: spacing[1], minWidth: 100 },
    metricLabel: { ...typography.caption, color: theme.colorMuted },
    balanceValue: { ...typography.bodyStrong, color: theme.color },
    label: { ...typography.caption, color: theme.colorMuted },
    value: { ...typography.bodyStrong, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    error: { ...typography.bodySm, color: theme.warning },
    loading: { alignItems: "center", flexDirection: "row", gap: spacing[2], paddingVertical: spacing[2] },
  });
}
