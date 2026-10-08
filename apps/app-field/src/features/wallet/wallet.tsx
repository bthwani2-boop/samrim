import { spacing } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useMemo, useState } from "react";
import { AppState, View } from "react-native";
import { useIsFocused } from "expo-router";
import { FieldFinancialSummaryCard } from "../account/field-financial-summary";
import { FieldPayoutCard } from "../account/field-payout-card";
import { createFieldOperationStyles } from "../field-operations/field-operation-styles";
import { FieldWalletHistory } from "./field-wallet-history";

export default function FieldWallet() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const isFocused = useIsFocused();
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    if (!isFocused) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setRefreshVersion((version) => version + 1);
    });
    return () => subscription.remove();
  }, [isFocused]);

  const refresh = () => setRefreshVersion((version) => version + 1);
  return <View style={[styles.container, { gap: spacing[4] }]} accessibilityLabel="محفظة الميدان"><FieldFinancialSummaryCard refreshVersion={refreshVersion} /><FieldPayoutCard onPayoutConfirmed={refresh} refreshVersion={refreshVersion} /><FieldWalletHistory refreshVersion={refreshVersion} /></View>;
}
