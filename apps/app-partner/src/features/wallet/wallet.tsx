import { spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { PartnerFinancialSummaryCard } from "../account/partner-financial-summary";
import { PartnerPayoutCard } from "../account/partner-payout-card";
import { StorePayoutRecipientsCard } from "./store-payout-recipients-card";
import { createPartnerSurfaceStyles } from "../partner-onboarding/partner-surface-styles";
import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";

export default function PartnerWallet() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const storeScope = usePartnerStoreScope();
  const canReadFinance = storeScope.stores.some((store) => store.owned || store.permissions.includes("finance_read"));
  const canRequestPayout = storeScope.stores.some((store) => store.owned || store.permissions.includes("payout_request"));
  const ownsAnyStore = storeScope.stores.some((store) => store.owned);
  return <View style={[styles.container, { gap: spacing[4] }]} accessibilityLabel="محفظة الشريك">
    <View style={styles.headerRow}>
      <View style={styles.headerCopy}>
        <Text style={styles.sectionTitle}>المحفظة</Text>
        <Text style={styles.muted}>المال المستحق للشريك وفق السجلات المالية المعتمدة.</Text>
      </View>
      <BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[6]} />
    </View>
    {canReadFinance ? <PartnerFinancialSummaryCard /> : <View style={styles.card}><Text style={styles.muted}>قراءة المالية غير ممنوحة لحسابك على أي متجر.</Text></View>}
    {canRequestPayout ? <PartnerPayoutCard /> : null}
    {ownsAnyStore ? <StorePayoutRecipientsCard /> : null}
  </View>;
}
