import { spacing, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { CaptainPayoutCard } from "../account/captain-payout-card";
import { CaptainCashInPanel } from "./cash-in-panel";

export default function CaptainWallet() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    body: { padding: spacing[3], paddingBottom: spacing[5], gap: spacing[2] },
    title: { ...typography.titleLg, color: theme.color },
  }), [theme]);
  return <View style={styles.screen} accessibilityLabel="محفظة الكابتن">
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}>
      <Text accessibilityRole="header" style={styles.title}>المحفظة</Text>
      <CaptainCashInPanel />
      <CaptainPayoutCard />
    </ScrollView>
  </View>;
}
