import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type JoiningCaseResponse, publicationStateLabel, type PublicationState, type StoreFulfillmentMode } from "@bthwani/dsh";
import { type Href, Link } from "expo-router";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { STORE_SURFACE_PERMISSIONS } from "../../shell/partner-authority";
import { StoreOfferManagement } from "../store-offer/store-offer";
import { StorePromotionsCard } from "../store-offer/store-promotions";
import { PartnerAccessInvitationsCard } from "./partner-access-invitations";
import { PartnerStoreAccess } from "./partner-store-access";
import { usePartnerStoreContext } from "./partner-store-context";
import { type PartnerAccessibleStore, usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { StoreCaptainMembershipManagement } from "./store-captain-memberships";
import { StoreCommercialAgreements } from "./store-commercial-agreements";
import { StoreOperationalAvailabilityManagement } from "./store-operational-availability";
import { StoreProfileImageEditor } from "./store-profile-image-editor";

type SurfaceStyles = ReturnType<typeof createPartnerSurfaceStyles>;

function publicationLabel(state: string): string {
  return state === "published" || state === "unpublished" || state === "hidden"
    ? publicationStateLabel(state as PublicationState)
    : "حالة النشر غير متاحة";
}

function isStoreFulfillmentMode(value: string): value is StoreFulfillmentMode {
  return value === "BTHWANI_CAPTAIN" || value === "PARTNER_CAPTAIN" || value === "CUSTOMER_PICKUP";
}

function StoreHeaderRow({ styles, store }: { styles: SurfaceStyles; store: PartnerAccessibleStore }) {
  const published = store.publicationState === "published";
  return <View style={styles.headerRow}>
    <View style={styles.headerCopy}>
      <Text style={styles.metaLabel}>{store.owned ? "متجر تملكه" : "وصول مفوض"}</Text>
      <Text selectable style={styles.value}>{store.name}</Text>
    </View>
    <BthwaniStatusBadge icon={published ? "success" : "warning"} label={published ? "منشور" : publicationLabel(store.publicationState)} tone={published ? "success" : "warning"} />
  </View>;
}

function FirstJoiningStoreFacts({ styles, store }: { styles: SurfaceStyles; store: NonNullable<JoiningCaseResponse["case"]["store"]> }) {
  return <View style={styles.card}>
    <Text style={styles.metaLabel}>موقع المتجر الثابت</Text>
    <Text style={styles.value}>{store.deliveryOrigin ? "محدد ضمن بيانات المتجر" : "لم يُثبت ضمن ملف الانضمام"}</Text>
    <Text style={styles.muted}>يبقى تعديل بيانات الانضمام من مسار التصحيح عندما يكون مطلوبًا.</Text>
  </View>;
}

function StoreManagementSurfaces({ styles, store, canCatalog, canOperate, canPromote, firstStoreCase, onProfileImageUpdated }: { styles: SurfaceStyles; store: PartnerAccessibleStore; canCatalog: boolean; canOperate: boolean; canPromote: boolean; firstStoreCase: JoiningCaseResponse | null; onProfileImageUpdated: (next: JoiningCaseResponse) => void }) {
  const firstJoiningStore = firstStoreCase?.case.store;
  const isSameFirstJoiningStore = Boolean(store.owned && firstJoiningStore && firstJoiningStore.id === store.id);
  return <>
    {store.owned ? <StoreCommercialAgreements key={store.id} storeID={store.id} /> : null}
    {isSameFirstJoiningStore && firstStoreCase ? <StoreProfileImageEditor value={firstStoreCase} onUpdated={onProfileImageUpdated} /> : null}
    {canOperate ? <StoreOperationalAvailabilityManagement storeID={store.id} fulfillmentModes={store.fulfillmentModes.filter(isStoreFulfillmentMode)} /> : null}
    {canCatalog && store.primaryVerticalId ? <StoreOfferManagement storeId={store.id} verticalId={store.primaryVerticalId} /> : null}
    {canCatalog && !store.primaryVerticalId ? <View style={styles.card}><Text style={styles.muted}>تعذر فتح إدارة المنتجات لأن تصنيف نشاط المتجر غير متاح في القراءة الحالية.</Text></View> : null}
    {canPromote ? <StorePromotionsCard storeID={store.id} /> : null}
    {isSameFirstJoiningStore && firstJoiningStore ? <FirstJoiningStoreFacts styles={styles} store={firstJoiningStore} /> : null}
    {store.owned ? <StoreCaptainMembershipManagement storeID={store.id} /> : null}
    {store.owned ? <PartnerStoreAccess storeID={store.id} /> : null}
    <PartnerAccessInvitationsCard />
  </>;
}

export function PartnerStore() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state: scopeState, selectedStore } = usePartnerStoreScope();
  const onboarding = usePartnerStoreContext();
  const firstStoreCase = onboarding.state.kind === "ready" ? onboarding.state.value : null;
  const canCatalog = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")));
  const canOperate = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("store_operations")));
  const canPromote = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("promotions")));

  return <View style={styles.container}>
    <Text style={styles.sectionTitle}>المتجر</Text>
    <PartnerStoreScopeSelector requiredPermissions={STORE_SURFACE_PERMISSIONS} />

    {scopeState.kind === "ready" && !selectedStore ? <View style={styles.card}>
      <Text style={styles.muted}>لا يوجد متجر مملوك أو مفوض لهذا الحساب حاليًا.</Text>
      <PartnerAccessInvitationsCard />
    </View> : null}

    {selectedStore ? <>
      <StoreHeaderRow styles={styles} store={selectedStore} />
      <StoreManagementSurfaces canCatalog={canCatalog} canOperate={canOperate} canPromote={canPromote} firstStoreCase={firstStoreCase} onProfileImageUpdated={onboarding.update} store={selectedStore} styles={styles} />
    </> : null}

    {onboarding.state.kind === "ready" && onboarding.state.value.case.state === "needs_correction" ? <Link href={"/onboarding" as Href} asChild><BthwaniButton label="مراجعة التصحيح المطلوب في ملف الانضمام" variant="secondary" /></Link> : null}
    {onboarding.state.kind === "error" ? <View style={styles.card}><Text style={styles.muted}>تعذر قراءة سجل الانضمام. إدارة المتاجر الحالية ما زالت تعتمد على نطاق المتاجر المعتمد أعلاه.</Text><BthwaniButton label="إعادة قراءة سجل الانضمام" onPress={() => void onboarding.reload()} variant="secondary" /></View> : null}
  </View>;
}
