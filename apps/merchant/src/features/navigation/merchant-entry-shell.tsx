import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { usePrimaryNavigation } from "@bthwani/tamagui-config/navigation";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { merchantMobileSections, merchantNavigation } from "./merchant-workspace-model";

/**
 * A visible navigation preview while the Merchant has no verified Identity
 * session or DSH standing. Only the Identity form is interactive; these labels
 * never navigate to or preload protected Store or financial resources.
 */
export default function MerchantEntryShell({ children }: Readonly<{ children: ReactNode }>) {
  const { theme } = useMobileAppearance();
  const { desktop } = usePrimaryNavigation();
  const desktopItems = merchantNavigation;
  const mobileItems = merchantMobileSections.map(id => merchantNavigation.find(item => item.id === id))
    .filter(item => item !== undefined);

  const previewItem = (item: (typeof merchantNavigation)[number], compact = false) => (
    <View key={item.id} style={{
      minHeight: 44, justifyContent: "center",
      borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor,
      paddingHorizontal: compact ? 12 : 14, paddingVertical: 8,
      minWidth: compact ? 86 : undefined,
    }}>
      <Text style={{
        color: theme.colorSecondary, fontSize: compact ? 13 : 15,
        fontWeight: "600", textAlign: "center",
      }}>{item.label}</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, flexDirection: desktop ? "row" : "column" }}>
        {desktop ? (
          <View testID="merchant-guest-sidebar" style={{
            width: 240, backgroundColor: theme.surface,
            borderColor: theme.borderColor, borderLeftWidth: 1,
            padding: 16, gap: 12,
          }}>
            <Text style={{ color: theme.color, fontSize: 23, fontWeight: "700", textAlign: "auto" }}>
              بثواني
            </Text>
            <Text style={{ color: theme.colorSecondary, textAlign: "auto" }}>مساحة التاجر</Text>
            <Text style={{ color: theme.color, fontWeight: "700", marginTop: 14, textAlign: "auto" }}>
              الأقسام الرئيسية
            </Text>
            <View accessibilityLabel="معاينة أقسام مساحة التاجر، غير قابلة للدخول قبل تسجيل الدخول"
              style={{ gap: 7 }}>
              {desktopItems.map(item => previewItem(item))}
            </View>
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View testID="merchant-guest-locked-notice" style={{
            paddingHorizontal: 16, paddingTop: 12, alignItems: "center",
          }}>
            <Text style={{ color: theme.colorSecondary, textAlign: "center" }}>
              الأقسام ظاهرة للتعريف فقط. يتطلب الدخول إلى بيانات المتاجر التحقق من Identity وDSH.
            </Text>
          </View>
          {children}
          {!desktop ? (
            <View testID="merchant-guest-mobile-tabs" style={{
              backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.borderColor,
              paddingVertical: 6,
            }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                accessibilityLabel="تبويبات مساحة التاجر، غير متاحة قبل التحقق"
                contentContainerStyle={{ paddingHorizontal: 10, gap: 7, alignItems: "center" }}>
                {mobileItems.map(item => previewItem(item, true))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
