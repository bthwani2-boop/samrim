import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { SafeAreaView, Text, View } from "react-native";

// The initial Identity authentication/verified Merchant session flow is not implemented.
// No local login or Store authority may be fabricated by this application.
export default function MerchantIdentityGate() {
  const { theme } = useMobileAppearance();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 16 }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 27, fontWeight: "700" }}>
          بثواني — التاجر
        </Text>
        <Text accessibilityRole="alert" style={{ color: theme.warningText, fontSize: 18 }}>
          لم يتم تفعيل تسجيل الدخول للتاجر بعد.
        </Text>
        <Text style={{ color: theme.color, lineHeight: 27, fontSize: 16 }}>
          يتطلب فتح مساحة المتجر جلسة Merchant موثّقة من Identity وصلاحية Store فعّالة من DSH.
          لا يمكن فتح الطلبات أو المنتجات أو الحساب المالي اعتمادًا على بيانات محلية أو معاينة.
        </Text>
      </View>
    </SafeAreaView>
  );
}
