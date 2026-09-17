import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, useColorScheme, View } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { publicationStateLabel } from "@bthwani/dsh";

import { usePartnerStoreContext } from "./partner-store-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { OrderManagement } from "../order-management/order-management";

export function PartnerOrders() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { cities, citiesError, state, reload } = usePartnerStoreContext();

  if (state.kind === "loading") return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات طلبات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة بيانات طلبات المتجر…</Text></View>;
  if (state.kind === "empty") return <View style={styles.state}><Text style={styles.muted}>لم يُنشأ المتجر الأول للشريك بعد.</Text><Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.linkButton}><Text style={styles.linkText}>إعادة القراءة</Text></Pressable></View>;
  if (state.kind === "error") return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الشريك من المنصة.</Text><Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.linkButton}><Text style={styles.linkText}>إعادة المحاولة</Text></Pressable></View>;
  const cityName = cities.find((city) => city.id === state.value.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>طلبات المتجر</Text>
      <Text selectable style={styles.value}>{state.value.case.businessName}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      {citiesError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة مدن الخدمة، لذلك قد لا يظهر اسم المدينة.</Text><Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.linkButton}><Text style={styles.linkText}>إعادة قراءة المدن</Text></Pressable></View> : null}
      {state.value.case.store ? <>
        <Text selectable style={styles.muted}>المتجر الأول: {state.value.case.store.name}</Text>
        <Text style={styles.muted}>حالة النشر: {publicationStateLabel(state.value.case.store.publicationState)}</Text>
        <Text style={styles.muted}>جاهزية النشر: {state.value.case.store.publicationReadiness.ready ? "جاهز" : "يحتاج إلى استكمال البيانات"}</Text>
        <OrderManagement storeId={state.value.case.store.id} />
      </> : <Text style={styles.muted}>لم يُنشأ المتجر بعد. راجع دورة الانضمام لإكمال أي تصحيح مطلوب.</Text>}
    </View>
  );
}
