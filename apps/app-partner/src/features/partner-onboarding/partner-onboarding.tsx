import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, useColorScheme, View } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { joiningCaseStateLabel } from "@bthwani/dsh";

import { JoiningCaseCorrection } from "./joining-case-correction";
import { usePartnerStoreContext } from "./partner-store-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

export function PartnerOnboarding() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const { cities, citiesError, state, update, reload } = usePartnerStoreContext();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);

  if (state.kind === "loading") return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات الانضمام" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة بيانات الانضمام…</Text></View>;
  if (state.kind === "empty") return <View style={styles.state}><Text style={styles.muted}>لم يُنشأ ملف الانضمام الأول للشريك بعد.</Text><Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.linkButton}><Text style={styles.linkText}>إعادة القراءة</Text></Pressable></View>;
  if (state.kind === "error") return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الانضمام من المنصة.</Text><Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.linkButton}><Text style={styles.linkText}>إعادة المحاولة</Text></Pressable></View>;
  const cityName = cities.find((city) => city.id === state.value.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>انضمام الشريك</Text>
      <Text selectable style={styles.value}>{state.value.case.businessName}</Text>
      <Text style={styles.muted}>الحالة: {joiningCaseStateLabel(state.value.case.state)}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      {citiesError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة مدن الخدمة، لذلك قد لا يظهر اسم المدينة.</Text><Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.linkButton}><Text style={styles.linkText}>إعادة قراءة المدن</Text></Pressable></View> : null}
      <JoiningCaseCorrection cities={cities} value={state.value} onUpdated={update} />
    </View>
  );
}
