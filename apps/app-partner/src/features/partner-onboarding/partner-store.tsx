import { Link, type Href } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, useColorScheme, View } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { publicationStateLabel } from "@bthwani/dsh";

import { usePartnerStoreContext } from "./partner-store-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { StoreOfferManagement } from "../store-offer/store-offer";
import { StoreDeliveryOrigin } from "../location-core/store-delivery-origin";

export function PartnerStore() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { cities, citiesError, state, reload } = usePartnerStoreContext();

  if (state.kind === "loading") return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة بيانات المتجر…</Text></View>;
  if (state.kind === "empty") return <View style={styles.state}><Text style={styles.muted}>لم يُنشأ المتجر الأول للشريك بعد.</Text><Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.linkButton}><Text style={styles.linkText}>إعادة القراءة</Text></Pressable></View>;
  if (state.kind === "error") return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الشريك من المنصة.</Text><Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.linkButton}><Text style={styles.linkText}>إعادة المحاولة</Text></Pressable></View>;
  const joiningCase = state.value;
  const cityName = cities.find((city) => city.id === joiningCase.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>إدارة المتجر</Text>
      <Text selectable style={styles.value}>{joiningCase.case.businessName}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      {citiesError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة مدن الخدمة، لذلك قد لا يظهر اسم المدينة.</Text><Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.linkButton}><Text style={styles.linkText}>إعادة قراءة المدن</Text></Pressable></View> : null}
      {joiningCase.case.store ? <>
        <Text selectable style={styles.muted}>المتجر الأول: {joiningCase.case.store.name}</Text>
        <Text style={styles.muted}>حالة النشر: {publicationStateLabel(joiningCase.case.store.publicationState)}</Text>
        <Text style={styles.muted}>جاهزية النشر: {joiningCase.case.store.publicationReadiness.ready ? "جاهز" : "يحتاج إلى استكمال البيانات"}</Text>
        <StoreDeliveryOrigin storeId={joiningCase.case.store.id} />
        <StoreOfferManagement storeId={joiningCase.case.store.id} />
      </> : <Text style={styles.muted}>لم يُنشأ المتجر بعد. راجع دورة الانضمام لإكمال أي تصحيح مطلوب.</Text>}
      {joiningCase.case.state === "needs_correction" ? <Link href={"/onboarding" as Href} asChild><Pressable accessibilityRole="button" style={styles.linkButton}><Text style={styles.linkText}>مراجعة التصحيح المطلوب</Text></Pressable></Link> : null}
    </View>
  );
}
