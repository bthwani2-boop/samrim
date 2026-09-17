import { useMemo } from "react";
import { ActivityIndicator, Text, useColorScheme, View } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { publicationStateLabel } from "@bthwani/dsh";

import { usePartnerStoreContext } from "./partner-store-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { OrderManagement } from "../order-management/order-management";

export function PartnerOrders() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { cities, state } = usePartnerStoreContext();

  if (state.kind === "loading") return <ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات طلبات المتجر" color={theme.actionBackground} />;
  if (state.kind === "empty") return <Text style={styles.muted}>لم يُنشأ المتجر الأول للشريك بعد.</Text>;
  if (state.kind === "error") return <Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الشريك من المنصة.</Text>;
  const cityName = cities.find((city) => city.id === state.value.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>طلبات المتجر</Text>
      <Text selectable style={styles.value}>{state.value.case.businessName}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      {state.value.case.store ? <>
        <Text selectable style={styles.muted}>المتجر الأول: {state.value.case.store.name}</Text>
        <Text style={styles.muted}>حالة النشر: {publicationStateLabel(state.value.case.store.publicationState)}</Text>
        <Text style={styles.muted}>جاهزية النشر: {state.value.case.store.publicationReadiness.ready ? "جاهز" : "يحتاج إلى استكمال البيانات"}</Text>
        <OrderManagement storeId={state.value.case.store.id} />
      </> : <Text style={styles.muted}>لم يُنشأ المتجر بعد. راجع دورة الانضمام لإكمال أي تصحيح مطلوب.</Text>}
    </View>
  );
}
