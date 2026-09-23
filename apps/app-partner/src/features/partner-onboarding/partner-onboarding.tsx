import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { joiningCaseStateLabel, type FulfillmentMode } from "@bthwani/dsh";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { JoiningCaseCorrection } from "./joining-case-correction";
import { usePartnerStoreContext } from "./partner-store-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

function fulfillmentModeLabel(mode: FulfillmentMode): string {
  return mode === "CUSTOMER_PICKUP" ? "الاستلام من المتجر" : "توصيل بثواني";
}

export function PartnerOnboarding() {
const theme = useAppearanceTheme();
  const { cities, citiesError, state, update, reload } = usePartnerStoreContext();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);

  if (state.kind === "loading") return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات الانضمام" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة بيانات الانضمام…</Text></View>;
  if (state.kind === "empty") return <View style={styles.state}><Text style={styles.muted}>لم يُنشأ ملف الانضمام الأول للشريك بعد.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void reload()} variant="secondary" /></View>;
  if (state.kind === "error") return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الانضمام من المنصة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void reload()} variant="secondary" /></View>;
  const cityName = cities.find((city) => city.id === state.value.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>انضمام الشريك</Text>
      <Text selectable style={styles.value}>{state.value.case.businessName}</Text>
      <Text style={styles.muted}>الحالة: {joiningCaseStateLabel(state.value.case.state)}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      <Text style={styles.muted}>طرق الاستلام في المتجر الأول: {state.value.case.firstStoreFulfillmentModes.map(fulfillmentModeLabel).join(" · ") || "لم تُحدد"}</Text>
      {citiesError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة مدن الخدمة، لذلك قد لا يظهر اسم المدينة.</Text><BthwaniButton label="إعادة قراءة المدن" onPress={() => void reload()} variant="secondary" /></View> : null}
      <JoiningCaseCorrection cities={cities} value={state.value} onUpdated={update} />
    </View>
  );
}
