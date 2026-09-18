import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { publicationStateLabel } from "@bthwani/dsh";
import { type Href, Link } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { StoreDeliveryOrigin } from "../location-core/store-delivery-origin";
import { StoreOfferManagement } from "../store-offer/store-offer";
import { usePartnerStoreContext } from "./partner-store-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

export function PartnerStore() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { cities, citiesError, state, reload } = usePartnerStoreContext();

  if (state.kind === "loading") return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة بيانات المتجر…</Text></View>;
  if (state.kind === "empty") return <View style={styles.state}><Text style={styles.muted}>لم يُنشأ المتجر الأول للشريك بعد.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void reload()} variant="secondary" /></View>;
  if (state.kind === "error") return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الشريك من المنصة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void reload()} variant="secondary" /></View>;
  const joiningCase = state.value;
  const cityName = cities.find((city) => city.id === joiningCase.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>إدارة المتجر</Text>
      <Text selectable style={styles.value}>{joiningCase.case.businessName}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      {citiesError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة مدن الخدمة، لذلك قد لا يظهر اسم المدينة.</Text><BthwaniButton label="إعادة قراءة المدن" onPress={() => void reload()} variant="secondary" /></View> : null}
      {joiningCase.case.store ? <>
        <Text selectable style={styles.muted}>المتجر الأول: {joiningCase.case.store.name}</Text>
        <Text style={styles.muted}>حالة النشر: {publicationStateLabel(joiningCase.case.store.publicationState)}</Text>
        <Text style={styles.muted}>جاهزية النشر: {joiningCase.case.store.publicationReadiness.ready ? "جاهز" : "يحتاج إلى استكمال البيانات"}</Text>
        <StoreDeliveryOrigin storeId={joiningCase.case.store.id} />
        <StoreOfferManagement storeId={joiningCase.case.store.id} />
      </> : <Text style={styles.muted}>لم يُنشأ المتجر بعد. راجع دورة الانضمام لإكمال أي تصحيح مطلوب.</Text>}
      {joiningCase.case.state === "needs_correction" ? <Link href={"/onboarding" as Href} asChild><BthwaniButton label="مراجعة التصحيح المطلوب" variant="secondary" /></Link> : null}
    </View>
  );
}
