import { spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { CaptainPayoutCard } from "../account/captain-payout-card";
import { createCaptainOperationStyles } from "../captain-operations/captain-operation-styles";

export default function CaptainWallet() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  return <View style={[styles.container, { gap: spacing[4] }]} accessibilityLabel="محفظة الكابتن"><View style={styles.orderHeader}><View><Text style={styles.title}>المحفظة</Text><Text style={styles.muted}>الرصيد والحجز الماليان كما يقرأهما WLT.</Text></View><BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[6]} /></View><CaptainPayoutCard /></View>;
}
