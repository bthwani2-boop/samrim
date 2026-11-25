import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { usePrimaryNavigation } from "@bthwani/tamagui-config/navigation";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MerchantDSHStanding } from "../access/dsh-standing";
import AccountScreen from "../account/account-screen";
import MerchantPrivateCatalog from "../catalog/merchant-private-catalog";
import EmployeesScreen from "../employees/employees-screen";
import MerchantStoreRegistration from "../onboarding/merchant-store-registration";
import MerchantStoreDirectory from "./merchant-store-directory";
import {
  type MerchantPublicationFilter,
  type MerchantSection,
  merchantMobileSections,
  merchantNavigation,
  merchantStoreSummary,
} from "./merchant-workspace-model";

export default function MerchantWorkspace({ actorId, stores, onRefresh, onSignOut }: Readonly<{
  actorId: string;
  stores: MerchantDSHStanding["stores"];
  onRefresh: () => void;
  onSignOut: () => void;
}>) {
  const { theme } = useMobileAppearance();
  const { desktop } = usePrimaryNavigation();
  const web = Platform.OS === "web";
  const webNavigation = merchantNavigation.filter(item => item.id !== "more");
  const [section, setSection] = useState<MerchantSection>("home");
  const [initialPublication, setInitialPublication] = useState<MerchantPublicationFilter>("all");
  const [catalogTarget, setCatalogTarget] = useState<{ actorId: string; storeId: string; priceStockOnly?: boolean } | null>(null);
  const catalogStoreId = catalogTarget?.actorId === actorId && stores.some(store => store.id === catalogTarget.storeId)
    ? catalogTarget.storeId : undefined;
  const [staffTarget, setStaffTarget] = useState<{ actorId: string; storeId: string } | null>(null);
  const staffStore = staffTarget?.actorId === actorId ? stores.find(store => store.id === staffTarget.storeId) : undefined;
  const openStaff = (storeId: string) => {
    if (!stores.some(store => store.id === storeId)) return;
    setStaffTarget({ actorId, storeId });
    setSection("staff");
  };
  const openSection = (next: MerchantSection) => {
    if (next === "staff" && section !== "staff") setStaffTarget(null);
    if (next === "stores" && section !== "stores") {
      setInitialPublication("all");
      setCatalogTarget(null);
    }
    if (next === "products" && section !== "products") setCatalogTarget(null);
    setSection(next);
  };
  const openStores = (publication: MerchantPublicationFilter) => {
    setInitialPublication(publication);
    setCatalogTarget(null);
    setSection("stores");
  };
  const openStore = (storeId: string) => {
    if (!stores.some(store => store.id === storeId)) return;
    setInitialPublication("all");
    setCatalogTarget({ actorId, storeId });
    setSection("stores");
  };
  const openCatalog = (storeId: string, priceStockOnly = false) => {
    if (!stores.some(store => store.id === storeId)) return;
    setCatalogTarget({ actorId, storeId, priceStockOnly });
    setSection("products");
  };
  const summary = merchantStoreSummary(stores);
  const selected = merchantNavigation.find(item => item.id === section) ?? merchantNavigation[0];

  const navigationButton = (item: (typeof merchantNavigation)[number], compact = false) => {
    const active = section === item.id;
    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        accessibilityState={{ selected: active }}
        onPress={() => openSection(item.id)}
        style={{
          flex: compact ? 1 : undefined,
          minHeight: 48,
          minWidth: 0,
          justifyContent: "center",
          borderRadius: 10,
          paddingHorizontal: compact ? 4 : 14,
          paddingVertical: 9,
          backgroundColor: active ? theme.actionSoft : "transparent",
        }}
      >
        <Text numberOfLines={compact ? 1 : undefined} style={{
          textAlign: compact ? "center" : "auto",
          fontSize: compact ? 12 : 15,
          color: active ? theme.interactiveText : theme.color,
          fontWeight: active ? "700" : "500",
        }}>{item.label}</Text>
      </Pressable>
    );
  };

  const metric = (title: string, value: number, publication: MerchantPublicationFilter, label: string) => (
    <Pressable key={title} accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={`عدد المتاجر: ${value}`} onPress={() => openStores(publication)} style={{
      flexGrow: 1, flexBasis: 120, minWidth: 110, padding: 16, gap: 8,
      borderColor: theme.borderColor, borderWidth: 1, borderRadius: 14,
      backgroundColor: theme.surface,
    }}>
      <Text style={{ color: theme.colorSecondary, textAlign: "auto" }}>{title}</Text>
      <Text style={{ color: theme.color, fontSize: 27, fontWeight: "700", textAlign: "auto" }}>{value}</Text>
    </Pressable>
  );

  const showStores = (
    <Pressable accessibilityRole="button" onPress={() => openStores("all")}
      style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center",
        borderRadius: 10, paddingHorizontal: 16, backgroundColor: theme.actionBackground }}>
      <Text style={{ color: theme.onAction, fontWeight: "700" }}>عرض متاجري</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, flexDirection: desktop ? "row" : "column" }}>
        {desktop ? (
          <View style={{
            width: 240, flexShrink: 0, backgroundColor: theme.surface, borderColor: theme.borderColor,
            borderLeftWidth: 1, padding: 16, gap: 12,
          }}>
            <Text style={{ color: theme.color, fontSize: 23, fontWeight: "700", textAlign: "auto" }}>
              بثواني
            </Text>
            <Text style={{ color: theme.colorSecondary, textAlign: "auto" }}>مساحة التاجر</Text>
            <View accessibilityRole="menu" style={{ gap: 16, marginTop: 18 }}>
              <View testID="merchant-navigation-group-operations" style={{ gap: 4 }}>
                <Text style={{ color: theme.colorSecondary, fontSize: 12, paddingHorizontal: 14 }}>إدارة الأعمال</Text>
                {webNavigation.filter(item => item.id !== "wallet" && item.id !== "account").map(item => navigationButton(item))}
              </View>
              <View testID="merchant-navigation-group-account" style={{ gap: 4 }}>
                <Text style={{ color: theme.colorSecondary, fontSize: 12, paddingHorizontal: 14 }}>المالية والحساب</Text>
                {webNavigation.filter(item => item.id === "wallet" || item.id === "account").map(item => navigationButton(item))}
              </View>
            </View>
            <View style={{ marginTop: "auto", borderTopWidth: 1, borderColor: theme.borderColor, paddingTop: 14, gap: 4 }}>
              <Text style={{ color: theme.color, fontWeight: "600" }}>الحساب موثّق</Text>
              <Text style={{ color: theme.colorSecondary, fontSize: 13 }}>{stores.length ? `المتاجر المرتبطة: ${stores.length}` : "لم يتم إنشاء متجر بعد"}</Text>
            </View>
          </View>
        ) : null}
        <ScrollView style={{ flex: 1, minWidth: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{
          width: "100%", maxWidth: 1080, alignSelf: "center",
          padding: desktop ? 30 : 16, gap: 20, paddingBottom: 32,
        }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <View style={{ flexGrow: 1, flexShrink: 1, gap: 6 }}>
                <Text accessibilityRole="header" style={{
                  color: theme.color, fontSize: desktop ? 28 : 24, fontWeight: "700", textAlign: "auto",
                }}>{selected.label}</Text>
                <Text style={{ color: theme.colorSecondary, textAlign: "auto" }}>{selected.description}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pressable accessibilityRole="button" onPress={onSignOut} style={{
                  paddingVertical: 11, paddingHorizontal: 13, borderRadius: 10,
                  borderWidth: 1, borderColor: theme.borderColor, minHeight: 44,
                }}>
                  <Text style={{ color: theme.interactiveText }}>خروج</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {section === "home" ? (
            <>
              {stores.length > 0 ? (
                <>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    {metric("متاجري", summary.total, "all", "عرض جميع المتاجر")}
                    {metric("المتاجر المنشورة", summary.published, "published", "عرض المتاجر المنشورة")}
                    {metric("غير المنشورة", summary.unpublished, "unpublished", "عرض المتاجر غير المنشورة")}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {showStores}
                    <Pressable accessibilityRole="button" accessibilityLabel="إدارة المنتجات"
                      onPress={() => openSection("products")}
                      style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: "center",
                        borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }}>
                      <Text style={{ color: theme.interactiveText, fontWeight: "700" }}>إدارة المنتجات</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
              {stores.length === 0 ? (
                <View testID="merchant-onboarding-next-step" style={{ gap: 20 }}>
                  <View style={{ backgroundColor: theme.actionSoft, borderRadius: 18, padding: 22, gap: 10 }}>
                    <Text style={{ color: theme.interactiveText, fontWeight: "700", fontSize: 13 }}>البدء مع بثواني</Text>
                    <Text accessibilityRole="header" style={{ color: theme.color, fontSize: desktop ? 30 : 24, fontWeight: "700" }}>
                      جهّز متجرك لبدء البيع
                    </Text>
                    <Text style={{ color: theme.colorSecondary, lineHeight: 25 }}>حسابك جاهز. تحتاج إلى تسجيل متجر واستكمال متطلبات اعتماده قبل استقبال الطلبات.</Text>
                  </View>
                  <View style={{ flexDirection: desktop ? "row" : "column", gap: 16, alignItems: "stretch" }}>
                    <View style={{ flex: 2, minWidth: 0 }}>
                      <MerchantStoreRegistration actorId={actorId} onCreated={onRefresh} />
                    </View>
                    <View testID="merchant-onboarding-roadmap" style={{
                      flex: 1, minWidth: 0, backgroundColor: theme.surface, borderWidth: 1,
                      borderColor: theme.borderColor, borderRadius: 14, padding: 18, gap: 18,
                    }}>
                      <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 19, fontWeight: "700" }}>رحلة إعداد المتجر</Text>
                      {[
                        ["١", "التحقق من الحساب", "تم التحقق من حسابك", theme.successText],
                        ["٢", "تسجيل المتجر", "المدينة، طريقة العمل وبيانات المتجر", theme.interactiveText],
                        ["٣", "استكمال التجهيز", "المنتجات، أوقات العمل والشروط المطلوبة", theme.colorSecondary],
                        ["٤", "الاعتماد والنشر", "حسب أهلية متجرك والمتطلبات المعتمدة", theme.colorSecondary],
                      ].map(([number, title, detail, color]) => (
                        <View key={number} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.actionSoft, alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color, fontWeight: "700" }}>{number}</Text>
                          </View>
                          <View style={{ flex: 1, gap: 4 }}>
                            <Text style={{ color: theme.color, fontWeight: "700" }}>{title}</Text>
                            <Text style={{ color: theme.colorSecondary, lineHeight: 21 }}>{detail}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              ) : (
                <View style={{ gap: 12 }}>
                  <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 20, fontWeight: "700" }}>إدارة متاجرك</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    {stores.slice(0, 4).map(store => (
                      <View key={store.id} style={{
                        flexGrow: 1, flexBasis: desktop ? 240 : "100%", minWidth: 0,
                        borderWidth: 1, borderColor: theme.borderColor, borderRadius: 14,
                        backgroundColor: theme.surface, padding: 16, gap: 10,
                      }}>
                        <Text style={{ color: theme.color, fontSize: 18, fontWeight: "700" }}>{store.name}</Text>
                        <Text style={{ color: theme.colorSecondary }}>
                          {store.relation === "MARKETPLACE" ? "سوق بثواني" : "متجر مباشر"} · {store.published ? "منشور" : "غير منشور"}
                        </Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <Pressable accessibilityRole="button" accessibilityLabel={`فتح متجر ${store.name}`}
                            onPress={() => openStore(store.id)}
                            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.actionBackground }}>
                            <Text style={{ color: theme.onAction, fontWeight: "700" }}>إدارة المتجر</Text>
                          </Pressable>
                          <Pressable accessibilityRole="button" accessibilityLabel={`منتجات متجر ${store.name}`}
                            onPress={() => openCatalog(store.id)}
                            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.borderColor }}>
                            <Text style={{ color: theme.interactiveText }}>المنتجات</Text>
                          </Pressable>
                          <Pressable accessibilityRole="button" accessibilityLabel={`أسعار ومخزون متجر ${store.name}`}
                            onPress={() => openCatalog(store.id, true)}
                            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.borderColor }}>
                            <Text style={{ color: theme.interactiveText }}>أسعار ومخزون المسودات</Text>
                          </Pressable>
                          <Pressable accessibilityRole="button" accessibilityLabel={`موظفو متجر ${store.name}`}
                            onPress={() => openStaff(store.id)}
                            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.borderColor }}>
                            <Text style={{ color: theme.interactiveText }}>الموظفون</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          ) : section === "stores" ? (
            <>
              <MerchantStoreDirectory key={JSON.stringify([actorId, initialPublication])}
                actorId={actorId} stores={stores} initialPublication={initialPublication}
                initialStoreId={catalogStoreId} onOpenCatalog={openCatalog} />
              <MerchantStoreRegistration actorId={actorId} onCreated={onRefresh} />
            </>
          ) : section === "products" ? (
            <>
              {catalogStoreId && stores.some(store => store.id === catalogStoreId) ? (
                <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى تفاصيل المتجر السابق"
                  onPress={() => setSection("stores")} style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}>
                  <Text style={{ color: theme.interactiveText }}>العودة إلى تفاصيل المتجر السابق</Text>
                </Pressable>
              ) : null}
              <MerchantPrivateCatalog key={actorId} actorId={actorId} stores={stores} initialStoreId={catalogStoreId}
                initialPriceStockOnly={Boolean(catalogStoreId && catalogTarget?.priceStockOnly)} />
            </>
          ) : section === "staff" ? (
            <View style={{ gap: 12 }}>
              <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 19, fontWeight: "700" }}>اختر المتجر لإدارة الموظفين</Text>
              <Text style={{ color: theme.colorSecondary }}>يُقرأ السجل من الخدمة المالكة وفق صلاحيتك. تسجيل الموظف لا يمنحه حسابًا أو إذن دخول.</Text>
              {stores.length === 0 ? (
                <Text accessibilityRole="alert" style={{ color: theme.warningText }}>لا توجد متاجر متاحة لحسابك.</Text>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {stores.map(store => (
                    <Pressable key={store.id} accessibilityRole="button" accessibilityLabel={`موظفو متجر ${store.name}`}
                      accessibilityState={{ selected: staffStore?.id === store.id }} onPress={() => openStaff(store.id)}
                      style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 10,
                        borderWidth: 1, borderColor: theme.borderColor, backgroundColor: staffStore?.id === store.id ? theme.actionSoft : theme.surface }}>
                      <Text style={{ color: staffStore?.id === store.id ? theme.interactiveText : theme.color }}>{store.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {staffStore ? <EmployeesScreen key={JSON.stringify([actorId, staffStore.id])} actorId={actorId} storeId={staffStore.id} /> : null}
            </View>
          ) : section === "account" ? (
            <AccountScreen />
          ) : section === "more" && !web ? (
            <View style={{ gap: 10 }}>
              <AccountScreen />
              {merchantNavigation.filter(item => item.id !== "more" && item.id !== "home" && item.id !== "account")
                .map(item => navigationButton(item))}
            </View>
          ) : (
            <View testID="merchant-section-unavailable" style={{
              padding: 24, borderWidth: 1, borderColor: theme.borderColor,
              borderRadius: 14, gap: 10, backgroundColor: theme.surface,
            }}>
              <Text accessibilityRole="alert" style={{ color: theme.warningText, fontSize: 18, fontWeight: "700" }}>
                هذه الوظيفة غير متاحة حاليًا
              </Text>
              <Text style={{ color: theme.colorSecondary }}>
                {section === "orders" ? "لم تُفعّل إدارة الطلبات بعد. يمكنك متابعة إعداد متجرك ومنتجاته." :
                  "لم تُفعّل الأرصدة والمستحقات بعد. لن تُعرض مبالغ غير مؤكدة."}
              </Text>
              {showStores}
            </View>
          )}
        </ScrollView>
      </View>
      {!desktop && web ? (
        <ScrollView horizontal keyboardShouldPersistTaps="handled" style={{
          flexGrow: 0, backgroundColor: theme.surface, borderTopWidth: 1, borderColor: theme.borderColor,
        }} contentContainerStyle={{ gap: 4, padding: 4, alignItems: "center" }}>
          {webNavigation.map(item => navigationButton(item))}
        </ScrollView>
      ) : !desktop ? (
        <View accessibilityRole="tablist" style={{
          backgroundColor: theme.surface, borderTopWidth: 1,
          borderColor: theme.borderColor, paddingHorizontal: 4,
          paddingTop: 5, paddingBottom: 4, flexDirection: "row",
        }}>
          {merchantMobileSections.map(id => {
            const item = merchantNavigation.find(candidate => candidate.id === id);
            return item ? navigationButton(item, true) : null;
          })}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
