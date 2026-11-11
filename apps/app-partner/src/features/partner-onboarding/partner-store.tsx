import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type JoiningCaseResponse, type PublicationState, publicationStateLabel, type StoreFulfillmentMode } from "@bthwani/dsh";
import { type Href, Link, Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { PartnerMarketingWorkspace, parsePartnerMarketingView } from "./partner-marketing-workspace";
import { mayPrepareIndependentStoreBanners } from "./independent-store-banner-access";
import { PartnerStoreBanners } from "../store-offer/partner-store-banners";
import { usePartnerStoreContext } from "./partner-store-context";
import { type PartnerAccessibleStore, usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { StoreCaptainMembershipManagement } from "./store-captain-memberships";
import { StoreCommercialAgreements } from "./store-commercial-agreements";
import { StoreOperationalAvailabilityManagement } from "./store-operational-availability";
import { StoreProfileImageEditor } from "./store-profile-image-editor";
import { PartnerStoreSettingsOverview } from "./partner-store-settings-overview";
import { PartnerStorePublicContact } from "./partner-store-public-contact";
import { PartnerIndependentCustomerPolicyDraftEditor } from "./partner-independent-customer-policy";
import { PartnerStorefrontLink } from "./partner-storefront-link";

type StoreSection = "operations" | "promotions" | "team" | "settings" | "commercial" | "banners" | "website";
function isStoreSection(value: string | undefined): value is StoreSection {
  return value === "operations" || value === "promotions" || value === "team" || value === "settings" || value === "commercial" || value === "banners" || value === "website";
}
function eligibleForSection(store: PartnerAccessibleStore, section: StoreSection): boolean {
  if (section === "commercial") return store.owned && (store.relationModel === "BTHWANI_PARTNER" || store.relationModel === "INDEPENDENT_STORE");
  if (section === "website") return store.relationModel === "INDEPENDENT_STORE" && store.owned;
  if (section === "banners") return mayPrepareIndependentStoreBanners(store);
  if (section === "operations" && store.relationModel === "INDEPENDENT_STORE") return store.owned;
  if (["operations", "promotions", "team"].includes(section) && store.relationModel !== "BTHWANI_PARTNER") return false;
  if (store.owned) return true;
  return section === "operations" ? store.permissions.includes("store_operations")
    : section === "promotions" ? store.permissions.includes("promotions") : false;
}
function isStoreFulfillmentMode(value: string): value is StoreFulfillmentMode {
  return value === "BTHWANI_CAPTAIN" || value === "PARTNER_CAPTAIN" || value === "CUSTOMER_PICKUP";
}

function FirstJoiningStoreFacts({ store }: { store: NonNullable<JoiningCaseResponse["case"]["store"]> }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  return <View style={styles.card}>
    <Text style={styles.metaLabel}>موقع المتجر الثابت</Text>
    <Text style={styles.value}>{store.deliveryOrigin ? "محدد ضمن بيانات المتجر" : "لم يُثبت ضمن ملف الانضمام"}</Text>
  </View>;
}

function TeamManagement({ storeID }: { storeID: string }) {
  return <StoreCaptainMembershipManagement storeID={storeID} />;
}

/** Each destination contains only the requested management function, with no secondary tab strip. */
export function PartnerStore() {
  const router = useRouter();
  const { section: rawSection, view: rawMarketingView } = useLocalSearchParams<{ section?: string | string[]; view?: string | string[] }>();
  const sectionValue = Array.isArray(rawSection) ? rawSection[0] : rawSection;
  const section = isStoreSection(sectionValue) ? sectionValue : null;
  const marketingView = parsePartnerMarketingView(Array.isArray(rawMarketingView) ? rawMarketingView[0] : rawMarketingView);
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { selectedStore, stores } = usePartnerStoreScope();
  const onboarding = usePartnerStoreContext();
  const firstStoreCase = onboarding.state.kind === "ready" ? onboarding.state.value : null;

  if (!section) return <Redirect href={"/more" as Href} />;

  const permitted = Boolean(selectedStore && eligibleForSection(selectedStore, section));
  const firstStore = firstStoreCase?.case.store;
  const firstStoreMatches = Boolean(selectedStore?.owned && firstStore && firstStore.id === selectedStore.id);
  const independent = selectedStore?.relationModel === "INDEPENDENT_STORE";

  return <View style={styles.container}>
    {stores.length > 1 ? <PartnerStoreScopeSelector eligible={(store) => eligibleForSection(store, section)} /> : null}
    {selectedStore && permitted ? <>
      {section === "operations" ? <StoreOperationalAvailabilityManagement key={selectedStore.id} storeID={selectedStore.id} preparingIndependent={independent} fulfillmentModes={selectedStore.fulfillmentModes.filter(isStoreFulfillmentMode)} /> : null}
      {section === "promotions" ? <PartnerMarketingWorkspace key={selectedStore.id} storeID={selectedStore.id} storeName={selectedStore.name} verticalID={selectedStore.primaryVerticalId} view={marketingView}/> : null}
      {section === "banners" ? <PartnerStoreBanners key={selectedStore.id} storeId={selectedStore.id} storeName={selectedStore.name} independent /> : null}
      {section === "website" ? <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.value}>موقع المتجر المستقل</Text>
        <Text style={styles.muted}>يُفتح الموقع الحقيقي للزوار بعد اعتماده في DSH؛ المنتجات والصور المنشورة فقط تظهر لهم. تبقى السياسات قيد المراجعة ضمن إدارة المتجر.</Text>
        <PartnerStorefrontLink key={selectedStore.id + ":website"} store={selectedStore} />
        <PartnerIndependentCustomerPolicyDraftEditor key={selectedStore.id + ":policy"} storeID={selectedStore.id} />
      </View> : null}
      {section === "team" ? <TeamManagement key={selectedStore.id} storeID={selectedStore.id} /> : null}
      {section === "commercial" ? <StoreCommercialAgreements key={selectedStore.id + ":agreements"} storeID={selectedStore.id} /> : null}
      {section === "settings" ? <>
        <PartnerStoreSettingsOverview key={selectedStore.id + ":settings"} storeID={selectedStore.id}
          canManageHours={eligibleForSection(selectedStore, "operations")} canReviewAgreement={eligibleForSection(selectedStore, "commercial")}
          preparingIndependent={independent} />
        {selectedStore.owned && selectedStore.publicationState !== "published" ? <View style={styles.card}>
          <Text style={styles.value}>{selectedStore.relationModel === "INDEPENDENT_STORE" ? "تجهيز محتوى المتجر المستقل" : selectedStore.relationModel === "BTHWANI_PARTNER" ? "تجهيز المتجر للنشر" : "تعذر التحقق من طريقة عمل المتجر"}</Text>
          {selectedStore.relationModel === "INDEPENDENT_STORE" ? <Text style={styles.muted}>يمكنك تجهيز المنتجات والصور. النشر العام والطلب المباشر غير مفعّلين حاليًا، ولا تمنح هذه الخطوة صلاحية النشر.</Text> : null}
          <BthwaniButton label="الانتقال إلى المنتجات" onPress={() => router.push("/products" as Href)} variant="secondary" />
        </View> : null}
        <PartnerStorePublicContact key={selectedStore.id + ":contact"} storeID={selectedStore.id} />
        <StoreProfileImageEditor key={selectedStore.id + ":image"} storeID={selectedStore.id} storeName={selectedStore.name} />
        {firstStoreMatches && firstStore ? <FirstJoiningStoreFacts store={firstStore} /> : null}
      </> : null}
    </> : <View style={styles.card}>
      <Text style={styles.muted}>{stores.length === 0 ? "لا يوجد متجر متاح لهذا الحساب حاليًا." : "لا تملك صلاحية إدارة هذا القسم في المتجر المحدد."}</Text>
    </View>}
    {onboarding.state.kind === "ready" && onboarding.state.value.case.state === "needs_correction" && section === "settings"
      ? <Link href={"/onboarding" as Href} asChild><BthwaniButton label="مراجعة التصحيح المطلوب في ملف الانضمام" variant="secondary" /></Link> : null}
  </View>;
}
