import { useMemo } from "react";
import { ActivityIndicator, Text, useColorScheme, View } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { joiningCaseStateLabel } from "@bthwani/dsh";

import { JoiningCaseCorrection } from "./joining-case-correction";
import { usePartnerStoreContext } from "./partner-store-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

export function PartnerOnboarding() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const { cities, state, update } = usePartnerStoreContext();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);

  if (state.kind === "loading") return <ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات الانضمام" color={theme.actionBackground} />;
  if (state.kind === "empty") return <Text style={styles.muted}>لم يُنشأ ملف الانضمام الأول للشريك بعد.</Text>;
  if (state.kind === "error") return <Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الانضمام من المنصة.</Text>;
  const cityName = cities.find((city) => city.id === state.value.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>انضمام الشريك</Text>
      <Text selectable style={styles.value}>{state.value.case.businessName}</Text>
      <Text style={styles.muted}>الحالة: {joiningCaseStateLabel(state.value.case.state)}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      <JoiningCaseCorrection value={state.value} onUpdated={update} />
    </View>
  );
}
