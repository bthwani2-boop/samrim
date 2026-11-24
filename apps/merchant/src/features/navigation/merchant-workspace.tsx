import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { usePrimaryNavigation } from "@bthwani/tamagui-config/navigation";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MerchantDSHStanding } from "../access/dsh-standing";
import MerchantPrivateCatalog from "../catalog/merchant-private-catalog";
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
  const [section, setSection] = useState<MerchantSection>("home");
  const [initialPublication, setInitialPublication] = useState<MerchantPublicationFilter>("all");
  const [catalogTarget, setCatalogTarget] = useState<{ actorId: string; storeId: string } | null>(null);
  const catalogStoreId = catalogTarget?.actorId === actorId ? catalogTarget.storeId : undefined;
  const openSection = (next: MerchantSection) => {
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
  const openCatalog = (storeId: string) => {
    if (!stores.some(store => store.id === storeId)) return;
    setCatalogTarget({ actorId, storeId });
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
            <View accessibilityRole="menu" style={{ gap: 4, marginTop: 18 }}>
              {merchantNavigation.map(item => navigationButton(item))}
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
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {metric("متاجري", summary.total, "all", "عرض جميع المتاجر")}
                {metric("المتاجر المنشورة", summary.published, "published", "عرض المتاجر المنشورة")}
                {metric("غير المنشورة", summary.unpublished, "unpublished", "عرض المتاجر غير المنشورة")}
              </View>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {showStores}
                {stores.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="إدارة المنتجات"
                  onPress={() => openSection("products")}
                  style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: "center",
                    borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }}>
                  <Text style={{ color: theme.interactiveText, fontWeight: "700" }}>إدارة المنتجات</Text>
                </Pressable>}
              </View>
              {stores.length === 0 ? <MerchantStoreRegistration actorId={actorId} onCreated={onRefresh} /> : null}
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
              <MerchantPrivateCatalog key={actorId} actorId={actorId} stores={stores} initialStoreId={catalogStoreId} />
            </>
          ) : section === "more" ? (
            <View style={{ gap: 10 }}>
              {merchantNavigation.filter(item => item.id !== "more" && item.id !== "home")
                .map(item => navigationButton(item))}
            </View>
          ) : (
            <View style={{
              padding: 24, borderWidth: 1, borderColor: theme.borderColor,
              borderRadius: 14, gap: 10, backgroundColor: theme.surface,
            }}>
              {showStores}
            </View>
          )}
        </ScrollView>
      </View>
      {!desktop ? (
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
