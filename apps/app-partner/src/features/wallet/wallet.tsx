import { spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PartnerFinancialSummaryCard } from "../account/partner-financial-summary";
import { PartnerPayoutCard } from "../account/partner-payout-card";
import { StorePayoutRecipientsCard } from "./store-payout-recipients-card";
import { createPartnerSurfaceStyles } from "../partner-onboarding/partner-surface-styles";
import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";

type WalletAction = "payout" | "recipients";

export default function PartnerWallet() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const premium = useMemo(() => StyleSheet.create({
    title: { ...typography.titleLg, fontSize: 28, fontWeight: "800", color: theme.color },
    subtitle: { ...typography.bodySm, color: theme.colorMuted },
    actionRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
    action: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, minHeight: 53, borderRadius: 14, padding: 8, borderWidth: 1, borderColor: theme.borderColor },
    actionLabel: { ...typography.bodyStrong, fontSize: 14, textAlign: "center" },
    panel: { backgroundColor: theme.surface, borderRadius: 15, borderColor: theme.borderColor, borderWidth: 1, padding: 10 },
  }), [theme]);
  const [openAction, setOpenAction] = useState<WalletAction | null>(null);
  const storeScope = usePartnerStoreScope();
  const financeScopeKey = storeScope.storesWithPermission("finance_read").map((store) => `${store.id}:${store.owned}`).join(",");
  const payoutScopeKey = storeScope.storesWithPermission("payout_request").map((store) => `${store.id}:${store.owned}`).join(",");
  const ownerScopeKey = storeScope.stores.filter((store) => store.owned).map((store) => store.id).join(",");
  const canReadFinance = storeScope.stores.some((store) => store.owned || store.permissions.includes("finance_read"));
  const canRequestPayout = storeScope.stores.some((store) => store.owned || store.permissions.includes("payout_request"));
  const ownsAnyStore = storeScope.stores.some((store) => store.owned);
  const actionButton = (action: WalletAction, label: string) => {
    const expanded = openAction === action;
    const primary = action === "payout";
    return <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "إغلاق " + label : label} accessibilityState={{ expanded }}
      key={action} onPress={() => setOpenAction((current) => current === action ? null : action)}
      style={[premium.action, { backgroundColor: primary ? theme.brandAction : theme.surface }]}>
      <BthwaniIcon name={primary ? "wallet" : "account"} size={18} color={primary ? theme.onAction : theme.color} />
      <Text style={[premium.actionLabel, { color: primary ? theme.onAction : theme.color }]}>{expanded ? "إغلاق " + label : label}</Text>
    </Pressable>;
  };
  const actionRow = canRequestPayout || ownsAnyStore ? <View style={premium.actionRow}>
    {ownsAnyStore ? actionButton("recipients", "حسابات الاستلام") : null}
    {canRequestPayout ? actionButton("payout", "طلب صرف") : null}
  </View> : null;
  const workflow = openAction === "payout" && canRequestPayout ? <View style={premium.panel}><PartnerPayoutCard key={"payout:" + payoutScopeKey} /></View>
    : openAction === "recipients" && ownsAnyStore ? <View style={premium.panel}><StorePayoutRecipientsCard key={"recipients:" + ownerScopeKey} /></View> : null;
  return <View style={[styles.container, { gap: spacing[3], paddingTop: spacing[4] }]} accessibilityLabel="محفظة الشريك">
    <Text accessibilityRole="header" style={premium.title}>المحفظة</Text>
    <Text style={premium.subtitle}>إدارة مستحقاتك وعمليات الصرف</Text>
    {canReadFinance ? <PartnerFinancialSummaryCard key={`finance:${financeScopeKey}`} actions={actionRow} workflow={workflow} /> : <>{actionRow}{workflow}</>}
    {!canReadFinance && !canRequestPayout && !ownsAnyStore ? <Text style={styles.muted}>لا توجد صلاحية مالية لهذا الحساب.</Text> : null}
  </View>;
}
