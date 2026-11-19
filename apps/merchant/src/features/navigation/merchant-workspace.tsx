import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MerchantDSHStanding } from "../access/dsh-standing";

export default function MerchantWorkspace({ stores, onRefresh, onSignOut }: Readonly<{
  stores: MerchantDSHStanding["stores"];
  onRefresh: () => void;
  onSignOut: () => void;
}>) {
  const { theme } = useMobileAppearance();
  const buttonStyle = { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" } as const;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{
        width: "100%", maxWidth: 1000, alignSelf: "center", padding: 24, gap: 16,
      }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 28, fontWeight: "700" }}>
            متاجري
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Pressable accessibilityRole="button" onPress={onRefresh} style={buttonStyle}>
              <Text style={{ color: theme.interactiveText }}>تحديث المتاجر</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onSignOut} style={buttonStyle}>
              <Text style={{ color: theme.interactiveText }}>تسجيل الخروج</Text>
            </Pressable>
          </View>
        </View>
        {stores.length === 0 ? (
          <Text style={{ color: theme.colorSecondary }}>لا توجد متاجر مملوكة لهذا الحساب.</Text>
        ) : stores.map(store => (
          <View key={store.id} style={{
            padding: 16, gap: 6, backgroundColor: theme.surface,
            borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12,
          }}>
            <Text style={{ color: theme.color, fontSize: 18, fontWeight: "700" }}>{store.name}</Text>
            <Text style={{ color: theme.colorSecondary }}>
              {store.relation === "MARKETPLACE" ? "ضمن سوق بثواني" : "متجر مباشر"}
              {" · "}
              {store.published ? "منشور" : "غير منشور"}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
