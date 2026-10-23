import { spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { PartnerFinancialSummaryCard } from "../account/partner-financial-summary";
import { PartnerPayoutCard } from "../account/partner-payout-card";
import { StorePayoutRecipientsCard } from "./store-payout-recipients-card";
import { createPartnerSurfaceStyles } from "../partner-onboarding/partner-surface-styles";
import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";

type WalletAction = "payout" | "recipients";

export default function PartnerWallet() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
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
    return <BthwaniButton key={action} label={expanded ? "إغلاق " + label : label}
      variant={action === "recipients" ? "secondary" : "primary"}
      onPress={() => setOpenAction((current) => current === action ? null : action)} />;
  };

  return <View style={[styles.container, { gap: spacing[3], paddingTop: spacing[3] }]} accessibilityLabel="محفظة الشريك">
    <Text accessibilityRole="header" style={{ ...typography.titleMd, color: theme.color }}>محفظة الشريك</Text>
    {canReadFinance ? <PartnerFinancialSummaryCard key={`finance:${financeScopeKey}`} /> : null}
    {canRequestPayout || ownsAnyStore ? <View style={styles.choiceRow}>
      {canRequestPayout ? actionButton("payout", "طلب صرف المستحقات") : null}
      {ownsAnyStore ? actionButton("recipients", "جهات الصرف") : null}
    </View> : null}
    {openAction === "payout" && canRequestPayout ? <PartnerPayoutCard key={`payout:${payoutScopeKey}`} /> : null}
    {openAction === "recipients" && ownsAnyStore ? <StorePayoutRecipientsCard key={`recipients:${ownerScopeKey}`} /> : null}
    {!canReadFinance && !canRequestPayout && !ownsAnyStore
      ? <Text style={styles.muted}>لا توجد صلاحية مالية لهذا الحساب.</Text> : null}
  </View>;
}
