import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { publicationStateLabel } from "@bthwani/dsh";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { OrderManagement } from "../order-management/order-management";
import { usePartnerStoreContext } from "./partner-store-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

export function PartnerOrders() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { cities, citiesError, state, reload } = usePartnerStoreContext();

  if (state.kind === "loading") return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات طلبات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة بيانات طلبات المتجر…</Text></View>;
  if (state.kind === "empty") return <View style={styles.state}><Text style={styles.muted}>لم يُنشأ المتجر الأول للشريك بعد.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void reload()} variant="secondary" /></View>;
  if (state.kind === "error") return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الشريك من المنصة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void reload()} variant="secondary" /></View>;
  const cityName = cities.find((city) => city.id === state.value.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>طلبات المتجر</Text>
      <Text selectable style={styles.value}>{state.value.case.businessName}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      {citiesError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة مدن الخدمة، لذلك قد لا يظهر اسم المدينة.</Text><BthwaniButton label="إعادة قراءة المدن" onPress={() => void reload()} variant="secondary" /></View> : null}
      {state.value.case.store ? <>
        <Text selectable style={styles.muted}>المتجر الأول: {state.value.case.store.name}</Text>
        <Text style={styles.muted}>حالة النشر: {publicationStateLabel(state.value.case.store.publicationState)}</Text>
        <Text style={styles.muted}>جاهزية النشر: {state.value.case.store.publicationReadiness.ready ? "جاهز" : "يحتاج إلى استكمال البيانات"}</Text>
        <OrderManagement storeId={state.value.case.store.id} />
      </> : <Text style={styles.muted}>لم يُنشأ المتجر بعد. راجع دورة الانضمام لإكمال أي تصحيح مطلوب.</Text>}
    </View>
  );
}
