import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { usePrimaryNavigation } from "@bthwani/tamagui-config/navigation";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MerchantDSHStanding } from "../access/dsh-standing";
import {
  type MerchantSection,
  merchantMobileSections,
  merchantNavigation,
  merchantStoreSummary,
} from "./merchant-workspace-model";

export default function MerchantWorkspace({ stores, onRefresh, onSignOut }: Readonly<{
  stores: MerchantDSHStanding["stores"];
  onRefresh: () => void;
  onSignOut: () => void;
}>) {
  const { theme } = useMobileAppearance();
  const { desktop } = usePrimaryNavigation();
  const [section, setSection] = useState<MerchantSection>("home");
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
        onPress={() => setSection(item.id)}
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

  const storeCard = (store: MerchantDSHStanding["stores"][number]) => (
    <View key={store.id} style={{
      padding: 16, gap: 6, borderRadius: 14, borderWidth: 1,
      borderColor: theme.borderColor, backgroundColor: theme.surface,
    }}>
      <Text style={{ color: theme.color, fontSize: 18, fontWeight: "700", textAlign: "auto" }}>
        {store.name}
      </Text>
      <Text style={{ color: theme.colorSecondary, textAlign: "auto" }}>
        {store.relation === "MARKETPLACE" ? "ضمن سوق بثواني" : "متجر مباشر"}
        {" · "}
        {store.published ? "منشور" : "غير منشور"}
      </Text>
    </View>
  );

  const metric = (title: string, value: number) => (
    <View key={title} style={{
      flexGrow: 1, flexBasis: 120, minWidth: 110, padding: 16, gap: 8,
      borderColor: theme.borderColor, borderWidth: 1, borderRadius: 14,
      backgroundColor: theme.surface,
    }}>
      <Text style={{ color: theme.colorSecondary, textAlign: "auto" }}>{title}</Text>
      <Text style={{ color: theme.color, fontSize: 27, fontWeight: "700", textAlign: "auto" }}>{value}</Text>
    </View>
  );

  const storeList = (
    <View style={{ gap: 10 }}>
      {stores.length === 0 ? (
        <View style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 18,
          borderWidth: 1, borderColor: theme.borderColor }}>
          <Text style={{ color: theme.color, textAlign: "auto", fontWeight: "600" }}>
            يمكنك دخول مساحة التاجر حتى لو لم يُربط بك أي متجر بعد.
          </Text>
          <Text style={{ color: theme.colorSecondary, textAlign: "auto", marginTop: 8 }}>
            إضافة المتجر ونشره وإسناد عضوياته إجراءات مستقلة يملكها DSH.
          </Text>
        </View>
      ) : stores.map(storeCard)}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, flexDirection: desktop ? "row" : "column" }}>
        {desktop ? (
          <View style={{
            width: 240, backgroundColor: theme.surface, borderColor: theme.borderColor,
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{
          width: "100%", maxWidth: 1080, alignSelf: "center",
          padding: desktop ? 30 : 16, gap: 20, paddingBottom: 32,
        }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <View style={{ flexGrow: 1, alignItems: "flex-end", gap: 6 }}>
                <Text accessibilityRole="header" style={{
                  color: theme.color, fontSize: desktop ? 28 : 24, fontWeight: "700", textAlign: "auto",
                }}>{selected.label}</Text>
                <Text style={{ color: theme.colorSecondary, textAlign: "auto" }}>{selected.description}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pressable accessibilityRole="button" onPress={onRefresh} style={{
                  paddingVertical: 11, paddingHorizontal: 13, borderRadius: 10,
                  borderWidth: 1, borderColor: theme.borderColor, minHeight: 44,
                }}>
                  <Text style={{ color: theme.interactiveText }}>تحديث</Text>
                </Pressable>
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
                {metric("متاجري", summary.total)}
                {metric("المتاجر المنشورة", summary.published)}
                {metric("غير المنشورة", summary.unpublished)}
              </View>
              <View style={{ gap: 10 }}>
                <Text style={{ color: theme.color, fontSize: 20, fontWeight: "700", textAlign: "auto" }}>متاجرك</Text>
                {storeList}
              </View>
            </>
          ) : section === "stores" ? storeList : section === "more" ? (
            <View style={{ gap: 10 }}>
              {merchantNavigation.filter(item => item.id !== "more" && item.id !== "home")
                .map(item => navigationButton(item))}
              <Text style={{ color: theme.colorSecondary, textAlign: "auto" }}>
                ترتبط إدارة الموظفين والملف الشخصي والاتفاقيات بسلطات ملاكها، ولا تُفتح من هذه القائمة وحدها.
              </Text>
            </View>
          ) : (
            <View style={{
              padding: 24, borderWidth: 1, borderColor: theme.borderColor,
              borderRadius: 14, gap: 10, backgroundColor: theme.surface,
            }}>
              <Text style={{ color: theme.color, fontSize: 19, fontWeight: "700", textAlign: "auto" }}>
                {selected.label}
              </Text>
              <Text accessibilityRole="alert" style={{ color: theme.colorSecondary, textAlign: "auto" }}>
                لم تُفعّل هذه الوظيفة بعد. لن تُعرض بيانات أو إجراءات غير مخولة حتى يكتمل ربطها واختبارها لدى مالكها.
              </Text>
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
