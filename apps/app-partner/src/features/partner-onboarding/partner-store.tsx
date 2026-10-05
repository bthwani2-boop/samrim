import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { publicationStateLabel, type PublicationState, type StoreFulfillmentMode } from "@bthwani/dsh";
import { type Href, Link } from "expo-router";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { StoreOfferManagement } from "../store-offer/store-offer";
import { PartnerStoreAccess } from "./partner-store-access";
import { usePartnerStoreContext } from "./partner-store-context";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { StoreCaptainMembershipManagement } from "./store-captain-memberships";
import { StoreCommercialAgreements } from "./store-commercial-agreements";
import { StoreOperationalAvailabilityManagement } from "./store-operational-availability";
import { StoreProfileImageEditor } from "./store-profile-image-editor";

function publicationLabel(state: string): string {
  return state === "published" || state === "unpublished" || state === "hidden"
    ? publicationStateLabel(state as PublicationState)
    : "حالة النشر غير متاحة";
}

function isStoreFulfillmentMode(value: string): value is StoreFulfillmentMode {
  return value === "BTHWANI_CAPTAIN" || value === "PARTNER_CAPTAIN" || value === "CUSTOMER_PICKUP";
}

export function PartnerStore() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state: scopeState, selectedStore } = usePartnerStoreScope();
  const onboarding = usePartnerStoreContext();
  const firstStoreCase = onboarding.state.kind === "ready" ? onboarding.state.value : null;
  const selectedIsFirstJoiningStore = Boolean(firstStoreCase?.case.store?.id && firstStoreCase.case.store.id === selectedStore?.id);
  const canCatalog = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")));
  const canOperate = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("store_operations")));

  return <View style={styles.container}>
    <Text style={styles.sectionTitle}>المتجر</Text>
    <PartnerStoreScopeSelector />

    {scopeState.kind === "ready" && !selectedStore ? <View style={styles.card}>
      <Text style={styles.muted}>لا يوجد متجر مملوك أو مفوض لهذا الحساب حاليًا.</Text>
      <PartnerStoreAccess />
    </View> : null}

    {selectedStore ? <>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.metaLabel}>{selectedStore.owned ? "متجر تملكه" : "وصول مفوض"}</Text>
          <Text selectable style={styles.value}>{selectedStore.name}</Text>
        </View>
        <BthwaniStatusBadge
          icon={selectedStore.publicationState === "published" ? "success" : "warning"}
          label={selectedStore.publicationState === "published" ? "منشور" : publicationLabel(selectedStore.publicationState)}
          tone={selectedStore.publicationState === "published" ? "success" : "warning"}
        />
      </View>

      {selectedStore.owned ? <StoreCommercialAgreements key={selectedStore.id} storeID={selectedStore.id} /> : null}
      {selectedStore.owned && selectedIsFirstJoiningStore && firstStoreCase ? <StoreProfileImageEditor value={firstStoreCase} onUpdated={onboarding.update} /> : null}

      {canOperate ? <StoreOperationalAvailabilityManagement storeID={selectedStore.id} fulfillmentModes={selectedStore.fulfillmentModes.filter(isStoreFulfillmentMode)} /> : null}
      {canCatalog && selectedStore.primaryVerticalId ? <StoreOfferManagement storeId={selectedStore.id} verticalId={selectedStore.primaryVerticalId} /> : null}
      {canCatalog && !selectedStore.primaryVerticalId ? <View style={styles.card}><Text style={styles.muted}>تعذر فتح إدارة المنتجات لأن تصنيف نشاط المتجر غير متاح في القراءة الحالية.</Text></View> : null}

      {selectedStore.owned && selectedIsFirstJoiningStore && firstStoreCase?.case.store ? <View style={styles.card}>
        <Text style={styles.metaLabel}>موقع المتجر الثابت</Text>
        <Text style={styles.value}>{firstStoreCase.case.store.deliveryOrigin ? "محدد ضمن بيانات المتجر" : "لم يُثبت ضمن ملف الانضمام"}</Text>
        <Text style={styles.muted}>يبقى تعديل بيانات الانضمام من مسار التصحيح عندما يكون مطلوبًا.</Text>
      </View> : null}

      {selectedStore.owned ? <StoreCaptainMembershipManagement storeID={selectedStore.id} /> : null}
      {selectedStore.owned ? <PartnerStoreAccess storeID={selectedStore.id} /> : <PartnerStoreAccess />}
    </> : null}

    {onboarding.state.kind === "ready" && onboarding.state.value.case.state === "needs_correction" ? <Link href={"/onboarding" as Href} asChild><BthwaniButton label="مراجعة التصحيح المطلوب في ملف الانضمام" variant="secondary" /></Link> : null}
    {onboarding.state.kind === "error" ? <View style={styles.card}><Text style={styles.muted}>تعذر قراءة سجل الانضمام. إدارة المتاجر الحالية ما زالت تعتمد على نطاق المتاجر المعتمد أعلاه.</Text><BthwaniButton label="إعادة قراءة سجل الانضمام" onPress={() => void onboarding.reload()} variant="secondary" /></View> : null}
  </View>;
}
