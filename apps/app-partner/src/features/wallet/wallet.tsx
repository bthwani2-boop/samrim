import { spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { PartnerFinancialSummaryCard } from "../account/partner-financial-summary";
import { PartnerPayoutCard } from "../account/partner-payout-card";
import { createPartnerSurfaceStyles } from "../partner-onboarding/partner-surface-styles";

export default function PartnerWallet() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  return <View style={[styles.container, { gap: spacing[4] }]} accessibilityLabel="محفظة الشريك"><View style={styles.headerRow}><View style={styles.headerCopy}><Text style={styles.sectionTitle}>المحفظة</Text><Text style={styles.muted}>المال المستحق للشريك كما يقرأه WLT.</Text></View><BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[6]} /></View><PartnerFinancialSummaryCard /><PartnerPayoutCard /></View>;
}
