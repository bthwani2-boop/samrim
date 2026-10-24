import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type JoiningCaseResponse, type PublicationState, publicationStateLabel, type StoreAccessPermission, type StoreFulfillmentMode } from "@bthwani/dsh";
import { type Href, Link, Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StorePromotionsCard } from "../store-offer/store-promotions";
import { PartnerStoreReels } from "../store-offer/partner-store-reels";
import { PartnerStoreAccess } from "./partner-store-access";
import { usePartnerStoreContext } from "./partner-store-context";
import { type PartnerAccessibleStore, usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { StoreCaptainMembershipManagement } from "./store-captain-memberships";
import { StoreCommercialAgreements } from "./store-commercial-agreements";
import { StoreOperationalAvailabilityManagement } from "./store-operational-availability";
import { StoreProfileImageEditor } from "./store-profile-image-editor";

type StoreSection = "operations" | "promotions" | "team" | "settings";
function isStoreSection(value: string | undefined): value is StoreSection {
  return value === "operations" || value === "promotions" || value === "team" || value === "settings";
}
function eligibleForSection(store: PartnerAccessibleStore, section: StoreSection): boolean {
  if (store.owned) return true;
  return section === "operations" ? store.permissions.includes("store_operations")
    : section === "promotions" ? store.permissions.includes("promotions") : false;
}
function requiredPermissions(section: StoreSection): ReadonlyArray<StoreAccessPermission> {
  return section === "operations" ? ["store_operations"]
    : section === "promotions" ? ["promotions"] : [];
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
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [adding, setAdding] = useState<"staff" | "captain" | null>(null);
  return <View style={{ gap: 8 }}>
    <View style={styles.headerRow}>
      <BthwaniButton label={adding ? "إغلاق" : "إضافة عضو"} variant="secondary" onPress={() => setAdding(adding ? null : "staff")} />
    </View>
    {adding ? <View style={styles.choiceRow}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: adding === "staff" }} onPress={() => setAdding("staff")} style={[styles.choice, adding === "staff" && styles.choiceSelected]}><Text style={adding === "staff" ? styles.choiceTextSelected : styles.choiceText}>موظف</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: adding === "captain" }} onPress={() => setAdding("captain")} style={[styles.choice, adding === "captain" && styles.choiceSelected]}><Text style={adding === "captain" ? styles.choiceTextSelected : styles.choiceText}>كابتن المتجر</Text></Pressable>
    </View> : null}
    {adding !== "captain" ? <PartnerStoreAccess storeID={storeID} showForm={adding === "staff"} /> : null}
    {adding !== "staff" ? <StoreCaptainMembershipManagement storeID={storeID} showForm={adding === "captain"} /> : null}
  </View>;
}

/** Each destination contains only the requested management function, with no secondary tab strip. */
export function PartnerStore() {
  const router = useRouter();
  const { section: rawSection } = useLocalSearchParams<{ section?: string | string[] }>();
  const sectionValue = Array.isArray(rawSection) ? rawSection[0] : rawSection;
  const section = isStoreSection(sectionValue) ? sectionValue : null;
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { selectedStore, stores } = usePartnerStoreScope();
  const onboarding = usePartnerStoreContext();
  const firstStoreCase = onboarding.state.kind === "ready" ? onboarding.state.value : null;

  if (!section) return <Redirect href={"/more" as Href} />;

  const permitted = Boolean(selectedStore && eligibleForSection(selectedStore, section));
  const firstStore = firstStoreCase?.case.store;
  const firstStoreMatches = Boolean(selectedStore?.owned && firstStore && firstStore.id === selectedStore.id);

  return <View style={styles.container}>
    {stores.length > 1 ? <PartnerStoreScopeSelector requiredPermissions={requiredPermissions(section)} /> : null}
    {selectedStore && permitted ? <>
      {section === "operations" ? <StoreOperationalAvailabilityManagement key={selectedStore.id} storeID={selectedStore.id} fulfillmentModes={selectedStore.fulfillmentModes.filter(isStoreFulfillmentMode)} /> : null}
      {section === "promotions" ? <><StorePromotionsCard key={selectedStore.id} storeID={selectedStore.id} verticalID={selectedStore.primaryVerticalId} /><PartnerStoreReels key={selectedStore.id + ":reels"} storeId={selectedStore.id} storeName={selectedStore.name} /></> : null}
      {section === "team" ? <TeamManagement key={selectedStore.id} storeID={selectedStore.id} /> : null}
      {section === "settings" ? <>
        {selectedStore.owned && selectedStore.publicationState !== "published" ? <View style={styles.card}>
          <Text style={styles.value}>تجهيز المتجر للنشر</Text>
          <BthwaniButton label="الانتقال إلى المنتجات" onPress={() => router.push("/products" as Href)} variant="secondary" />
        </View> : null}
        <StoreCommercialAgreements key={selectedStore.id + ":agreements"} storeID={selectedStore.id} />
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
