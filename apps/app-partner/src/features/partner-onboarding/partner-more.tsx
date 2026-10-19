import { BthwaniButton, BthwaniNavigationRow, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

export function PartnerMore() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { selectedStore, stores, selectStore, state, reload } = usePartnerStoreScope();
  const canManage = (permission: "store_operations" | "promotions") =>
    Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes(permission)));
  const firstManageable = stores.find((store) => store.owned || store.permissions.includes("store_operations") || store.permissions.includes("promotions"));
  const hasManageable = Boolean(firstManageable);

  useEffect(() => {
    if (state.kind !== "ready" || !firstManageable || !selectedStore) return;
    const selectedCanManage = selectedStore.owned || selectedStore.permissions.includes("store_operations") || selectedStore.permissions.includes("promotions");
    if (!selectedCanManage && firstManageable.id !== selectedStore.id) selectStore(firstManageable.id);
  }, [state.kind, firstManageable, selectedStore, selectStore]);

  function openSection(section: "operations" | "promotions" | "team" | "settings") {
    router.push({ pathname: "/store", params: { section } } as Href);
  }

  return <View style={styles.container}>
    <Text style={styles.sectionTitle}>المزيد</Text>
    {state.kind === "error" ? <View style={styles.card}>
      <Text accessibilityRole="alert" style={styles.error}>تعذر قراءة صلاحيات المتجر حاليًا. ما زال الحساب متاحًا.</Text>
      <BthwaniButton label="إعادة قراءة المتاجر" variant="secondary" onPress={() => void reload()} />
    </View> : null}
    {state.kind === "ready" && stores.length === 0 ? <View style={styles.card}>
      <BthwaniNavigationRow compact icon="store" title="طلب انضمام متجر" description="ابدأ طلب الانضمام أو أكمل بياناته" onPress={() => router.push("/onboarding" as Href)} />
    </View> : null}
    {hasManageable ? <>
      {stores.length > 1 ? <PartnerStoreScopeSelector requiredPermissions={["store_operations", "promotions"]} /> : null}
      {selectedStore ? <Text style={styles.muted}>{selectedStore.name}</Text> : null}
      {canManage("store_operations") || canManage("promotions") || selectedStore?.owned ? <View style={styles.card}>
        {canManage("store_operations") ? <BthwaniNavigationRow compact icon="store" title="التشغيل وساعات العمل" description="مواعيد الاستقبال وإتاحة المتجر والتجهيز" onPress={() => openSection("operations")} /> : null}
        {canManage("promotions") ? <BthwaniNavigationRow compact icon="offers" title="العروض والتخفيضات" description="الحملات والعروض الخاصة بالمتجر" onPress={() => openSection("promotions")} /> : null}
        {selectedStore?.owned ? <BthwaniNavigationRow compact icon="account" title="الفريق والصلاحيات" description="الموظفون والكباتن ودعوات الوصول" onPress={() => openSection("team")} /> : null}
        {selectedStore?.owned ? <BthwaniNavigationRow compact icon="store" title="بيانات المتجر والاتفاقيات" description="الصور والبيانات والاتفاقيات التجارية" onPress={() => openSection("settings")} /> : null}
      </View> : null}
    </> : null}
    <View style={styles.card}>
      <BthwaniNavigationRow compact icon="account" title="الحساب والإعدادات" description="دعوات الوصول والمظهر وتسجيل الخروج" onPress={() => router.push("/account" as Href)} />
    </View>
  </View>;
}
