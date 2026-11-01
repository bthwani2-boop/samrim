import { spacing, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { CaptainPayoutCard } from "../account/captain-payout-card";
import { CaptainCashInPanel } from "./cash-in-panel";

export default function CaptainWallet() {
  const theme = useAppearanceTheme();
  const [identityState, setIdentityState] = useState(currentIdentityState);
  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: {
      paddingHorizontal: spacing[3],
      paddingTop: spacing[3],
      paddingBottom: spacing[4],
      gap: spacing[2],
    },
    title: { ...typography.titleLg, color: theme.color },
  }), [theme]);

  return <View style={styles.screen} accessibilityLabel="محفظة الكابتن">
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <Text accessibilityRole="header" style={styles.title}>محفظة الكابتن</Text>
      <Text style={{ ...typography.caption, color: theme.colorMuted }}>الرصيد التشغيلي مستقل عن الأرباح المؤهلة للسحب.</Text>
      <CaptainCashInPanel key={activeActorID} />
      <CaptainPayoutCard key={activeActorID} />
    </ScrollView>
  </View>;
}
