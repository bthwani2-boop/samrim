import { spacing, typography } from "@bthwani/design-system";
import { BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { PartnerFinancialSummaryCard } from "../account/partner-financial-summary";
import { PartnerPayoutCard } from "../account/partner-payout-card";
import { StorePayoutRecipientsCard } from "./store-payout-recipients-card";
import { createPartnerSurfaceStyles } from "../partner-onboarding/partner-surface-styles";
import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";

export default function PartnerWallet() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [mode, setMode] = useState<"summary" | "payout" | "recipients">("summary");
  const storeScope = usePartnerStoreScope();
  const financeScopeKey = storeScope.storesWithPermission("finance_read").map((store) => `${store.id}:${store.owned}`).join(",");
  const payoutScopeKey = storeScope.storesWithPermission("payout_request").map((store) => `${store.id}:${store.owned}`).join(",");
  const ownerScopeKey = storeScope.stores.filter((store) => store.owned).map((store) => store.id).join(",");
  const canReadFinance = storeScope.stores.some((store) => store.owned || store.permissions.includes("finance_read"));
  const canRequestPayout = storeScope.stores.some((store) => store.owned || store.permissions.includes("payout_request"));
  const ownsAnyStore = storeScope.stores.some((store) => store.owned);

  return <View style={[styles.container, { gap: spacing[3], paddingTop: spacing[3] }]} accessibilityLabel="محفظة الشريك">
    <Text style={{ ...typography.titleMd, color: theme.color }}>المحفظة</Text>
    <View style={styles.choiceRow}>
      {canReadFinance ? <BthwaniChip label="الرصيد" selected={mode === "summary"} onPress={() => setMode("summary")} /> : null}
      {canRequestPayout ? <BthwaniChip label="طلب صرف" selected={mode === "payout"} onPress={() => setMode("payout")} /> : null}
      {ownsAnyStore ? <BthwaniChip label="حسابات الاستلام" selected={mode === "recipients"} onPress={() => setMode("recipients")} /> : null}
    </View>
    {mode === "summary" && canReadFinance ? <PartnerFinancialSummaryCard key={`finance:${financeScopeKey}`} /> : null}
    {mode === "payout" && canRequestPayout ? <PartnerPayoutCard key={`payout:${payoutScopeKey}`} /> : null}
    {mode === "recipients" && ownsAnyStore ? <StorePayoutRecipientsCard key={`recipients:${ownerScopeKey}`} /> : null}
    {!canReadFinance && !canRequestPayout && !ownsAnyStore ? <Text style={styles.muted}>لا توجد صلاحية مالية لهذا الحساب.</Text> : null}
  </View>;
}
