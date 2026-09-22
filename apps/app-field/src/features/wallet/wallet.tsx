import { spacing } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { FieldFinancialSummaryCard } from "../account/field-financial-summary";
import { FieldPayoutCard } from "../account/field-payout-card";
import { createFieldOperationStyles } from "../field-operations/field-operation-styles";

export default function FieldWallet() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  return <View style={[styles.container, { gap: spacing[4] }]} accessibilityLabel="محفظة الميدان"><View style={styles.orderHeader}><View><Text style={styles.title}>المحفظة</Text><Text style={styles.muted}>الاستحقاقات والتسوية كما يقرأهما WLT.</Text></View><BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[6]} /></View><FieldFinancialSummaryCard /><FieldPayoutCard /></View>;
}
