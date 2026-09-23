import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { publicationStateLabel } from "@bthwani/dsh";
import { type Href, Link } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { StoreOfferManagement } from "../store-offer/store-offer";
import { usePartnerStoreContext } from "./partner-store-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { StoreFulfillmentModeSettings } from "./store-fulfillment-mode-settings";

export function PartnerStore() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { cities, citiesError, state, update, reload } = usePartnerStoreContext();

  if (state.kind === "loading") return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة بيانات المتجر…</Text></View>;
  if (state.kind === "empty") return <View style={styles.state}><Text style={styles.muted}>لم يُنشأ المتجر الأول للشريك بعد.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void reload()} variant="secondary" /></View>;
  if (state.kind === "error") return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الشريك من المنصة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void reload()} variant="secondary" /></View>;
  const joiningCase = state.value;
  const cityName = cities.find((city) => city.id === joiningCase.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}><View style={styles.headerCopy}><Text style={styles.sectionTitle}>إدارة المتجر</Text><Text selectable style={styles.value}>{joiningCase.case.businessName}</Text></View><BthwaniStatusBadge icon={joiningCase.case.store?.publicationState === "published" ? "success" : "warning"} label={joiningCase.case.store?.publicationState === "published" ? "منشور" : "يحتاج إجراء"} tone={joiningCase.case.store?.publicationState === "published" ? "success" : "warning"} /></View>
      <View style={styles.card}><View style={styles.metaGrid}><View style={styles.metaItem}><Text style={styles.metaLabel}>مدينة الخدمة</Text><Text style={styles.value}>{cityName}</Text></View><View style={styles.metaItem}><Text style={styles.metaLabel}>حالة الملف</Text><Text style={styles.value}>{joiningCase.case.state === "needs_correction" ? "يحتاج تصحيحًا" : "قيد المتابعة"}</Text></View></View></View>
      {citiesError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة مدن الخدمة، لذلك قد لا يظهر اسم المدينة.</Text><BthwaniButton label="إعادة قراءة المدن" onPress={() => void reload()} variant="secondary" /></View> : null}
      {joiningCase.case.store ? <>
        {joiningCase.case.store.storeProfileImage?.uri ? <Image accessibilityLabel={`صورة متجر ${joiningCase.case.store.name}`} source={{ uri: joiningCase.case.store.storeProfileImage.uri }} style={{ borderRadius: 12, height: 180, width: "100%" }} resizeMode="cover" /> : null}
        <Text selectable style={styles.muted}>المتجر الأول: {joiningCase.case.store.name}</Text>
        <Text style={styles.muted}>حالة النشر: {publicationStateLabel(joiningCase.case.store.publicationState)}</Text>
        <Text style={styles.muted}>جاهزية النشر: {joiningCase.case.store.publicationReadiness.ready ? "جاهز" : "يحتاج إلى استكمال البيانات"}</Text>
        <StoreFulfillmentModeSettings
          key={`${joiningCase.case.store.id}:${joiningCase.case.store.version}`}
          storeID={joiningCase.case.store.id}
          version={joiningCase.case.store.version}
          savedModes={joiningCase.case.store.fulfillmentModes}
          onReload={() => void reload()}
          onSaved={(result) => update({
            ...joiningCase,
            case: {
              ...joiningCase.case,
              store: {
                ...joiningCase.case.store!,
                version: result.version,
                fulfillmentModes: result.fulfillmentModes,
              },
            },
          })}
        />
        <View style={styles.card}><Text style={styles.metaLabel}>موقع المتجر الثابت</Text><Text selectable style={styles.value}>{joiningCase.case.store.deliveryOrigin ? `${joiningCase.case.store.deliveryOrigin.latitude.toFixed(6)}, ${joiningCase.case.store.deliveryOrigin.longitude.toFixed(6)}` : "لم يُثبت ضمن ملف الانضمام"}</Text><Text style={styles.muted}>يُقرأ من ملف الانضمام ولا يُعدّل من هذه الشاشة.</Text></View>
        <StoreOfferManagement storeId={joiningCase.case.store.id} />
      </> : <Text style={styles.muted}>لم يُنشأ المتجر بعد. راجع دورة الانضمام لإكمال أي تصحيح مطلوب.</Text>}
      {joiningCase.case.state === "needs_correction" ? <Link href={"/onboarding" as Href} asChild><BthwaniButton label="مراجعة التصحيح المطلوب" variant="secondary" /></Link> : null}
    </View>
  );
}
