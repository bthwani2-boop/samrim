import { BthwaniButton, BthwaniChip, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type JoiningCaseResponse, publicationStateLabel, type PublicationState, type StoreFulfillmentMode } from "@bthwani/dsh";
import { type Href, Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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

function isStoreSurfaceEligible(store: PartnerAccessibleStore): boolean {
  return store.owned || STORE_SURFACE_PERMISSIONS.some((permission) => store.permissions.includes(permission));
}

function StoreHeaderRow({ styles, store }: { styles: SurfaceStyles; store: PartnerAccessibleStore }) {
  const published = store.publicationState === "published";
  return <View style={styles.headerRow}>
    <View style={styles.headerCopy}>
      {!store.owned ? <Text style={styles.metaLabel}>وصول مفوض</Text> : null}
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

type StoreSection = "operations" | "catalog" | "promotions" | "team" | "settings";

function StoreManagementSurfaces({ styles, store, canCatalog, canOperate, canPromote, firstStoreCase }: { styles: SurfaceStyles; store: PartnerAccessibleStore; canCatalog: boolean; canOperate: boolean; canPromote: boolean; firstStoreCase: JoiningCaseResponse | null }) {
  const firstJoiningStore = firstStoreCase?.case.store;
  const isSameFirstJoiningStore = Boolean(store.owned && firstJoiningStore && firstJoiningStore.id === store.id);
  const sections: ReadonlyArray<{ id: StoreSection; label: string }> = [
    ...(canOperate ? [{ id: "operations" as const, label: "التشغيل" }] : []),
    ...(canCatalog ? [{ id: "catalog" as const, label: "المنتجات" }] : []),
    ...(canPromote ? [{ id: "promotions" as const, label: "العروض" }] : []),
    { id: "team", label: "الفريق" },
    ...(store.owned ? [{ id: "settings" as const, label: "بيانات المتجر" }] : []),
  ];
  const [section, setSection] = useState<StoreSection>(sections[0]?.id ?? "team");
  const [visited, setVisited] = useState<ReadonlyArray<StoreSection>>([sections[0]?.id ?? "team"]);

  function showSection(next: StoreSection) {
    setSection(next);
    setVisited((current) => current.includes(next) ? current : [...current, next]);
  }

  return <View style={styles.managementSections}>
    <View style={styles.choiceRow} accessibilityLabel="أقسام إدارة المتجر">
      {sections.map((item) => <BthwaniChip key={item.id} label={item.label} selected={section === item.id} onPress={() => showSection(item.id)} />)}
    </View>
    <View style={section === "operations" ? undefined : styles.hiddenSection} accessibilityElementsHidden={section !== "operations"} importantForAccessibility={section === "operations" ? "auto" : "no-hide-descendants"}>
      {visited.includes("operations") && canOperate ? <StoreOperationalAvailabilityManagement storeID={store.id} fulfillmentModes={store.fulfillmentModes.filter(isStoreFulfillmentMode)} /> : null}
    </View>
    <View style={section === "catalog" ? undefined : styles.hiddenSection} accessibilityElementsHidden={section !== "catalog"} importantForAccessibility={section === "catalog" ? "auto" : "no-hide-descendants"}>
      {visited.includes("catalog") && canCatalog && store.primaryVerticalId ? <StoreOfferManagement storeId={store.id} verticalId={store.primaryVerticalId} /> : null}
      {visited.includes("catalog") && canCatalog && !store.primaryVerticalId ? <View style={styles.card}><Text style={styles.muted}>تعذر فتح إدارة المنتجات لأن تصنيف نشاط المتجر غير متاح في القراءة الحالية.</Text></View> : null}
    </View>
    <View style={section === "promotions" ? undefined : styles.hiddenSection} accessibilityElementsHidden={section !== "promotions"} importantForAccessibility={section === "promotions" ? "auto" : "no-hide-descendants"}>
      {visited.includes("promotions") && canPromote ? <StorePromotionsCard storeID={store.id} verticalID={store.primaryVerticalId} /> : null}
    </View>
    <View style={section === "team" ? undefined : styles.hiddenSection} accessibilityElementsHidden={section !== "team"} importantForAccessibility={section === "team" ? "auto" : "no-hide-descendants"}>
      {visited.includes("team") && store.owned ? <StoreCaptainMembershipManagement storeID={store.id} /> : null}
      {visited.includes("team") && store.owned ? <PartnerStoreAccess storeID={store.id} /> : null}
      {visited.includes("team") ? <PartnerAccessInvitationsCard /> : null}
    </View>
    <View style={section === "settings" ? undefined : styles.hiddenSection} accessibilityElementsHidden={section !== "settings"} importantForAccessibility={section === "settings" ? "auto" : "no-hide-descendants"}>
      {visited.includes("settings") && store.owned ? <StoreCommercialAgreements storeID={store.id} /> : null}
      {visited.includes("settings") && store.owned ? <StoreProfileImageEditor storeID={store.id} storeName={store.name} /> : null}
      {visited.includes("settings") && isSameFirstJoiningStore && firstJoiningStore ? <FirstJoiningStoreFacts styles={styles} store={firstJoiningStore} /> : null}
    </View>
  </View>;
}

export function PartnerStore() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state: scopeState, selectedStore, stores, selectStore } = usePartnerStoreScope();
  const onboarding = usePartnerStoreContext();
  const firstStoreCase = onboarding.state.kind === "ready" ? onboarding.state.value : null;
  const canCatalog = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")));
  const canOperate = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("store_operations")));
  const canPromote = Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("promotions")));

  // Landing on المتجر must present a store this actor holds a material store
  // function on; a selection carried over from another surface never leaves
  // the Store surface on a functionless store.
  useEffect(() => {
    if (scopeState.kind !== "ready" || !selectedStore || isStoreSurfaceEligible(selectedStore)) return;
    const firstEligible = stores.find(isStoreSurfaceEligible);
    if (firstEligible) selectStore(firstEligible.id);
  }, [scopeState.kind, selectedStore, stores, selectStore]);

  return <View style={styles.container}>
    {scopeState.kind !== "ready" || stores.length > 1 ? <PartnerStoreScopeSelector requiredPermissions={STORE_SURFACE_PERMISSIONS} /> : null}

    {scopeState.kind === "ready" && !selectedStore ? <View style={styles.card}>
      <Text style={styles.muted}>لا يوجد متجر مملوك أو مفوض لهذا الحساب حاليًا.</Text>
      <PartnerAccessInvitationsCard />
    </View> : null}

    {selectedStore ? <>
      <StoreHeaderRow styles={styles} store={selectedStore} />
      <StoreManagementSurfaces key={selectedStore.id} canCatalog={canCatalog} canOperate={canOperate} canPromote={canPromote} firstStoreCase={firstStoreCase} store={selectedStore} styles={styles} />
    </> : null}

    {onboarding.state.kind === "ready" && onboarding.state.value.case.state === "needs_correction" ? <Link href={"/onboarding" as Href} asChild><BthwaniButton label="مراجعة التصحيح المطلوب في ملف الانضمام" variant="secondary" /></Link> : null}
    {onboarding.state.kind === "error" ? <View style={styles.card}><Text style={styles.muted}>تعذر قراءة سجل الانضمام. إدارة المتاجر الحالية ما زالت تعتمد على نطاق المتاجر المعتمد أعلاه.</Text><BthwaniButton label="إعادة قراءة سجل الانضمام" onPress={() => void onboarding.reload()} variant="secondary" /></View> : null}
  </View>;
}
