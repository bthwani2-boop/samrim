import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { SafeAreaView, ScrollView, Text, View } from "react-native";

export default function CaptainIdentityGate() {
  const { theme } = useMobileAppearance();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 28, fontWeight: "700" }}>بثواني — الكابتن</Text>
        <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderRadius: 14, borderColor: theme.borderColor, padding: 20, gap: 12 }}>
          <Text testID="captain-login-unavailable" accessibilityRole="alert" style={{ color: theme.warningText, fontSize: 19, fontWeight: "600" }}>
            لم يتم تفعيل تسجيل الدخول للكابتن بعد.
          </Text>
          <Text style={{ color: theme.color, fontSize: 16, lineHeight: 26 }}>
            يجب ربط التسجيل والتحقق والجلسات بخدمة Identity قبل تمكين مهام DSH أو بيانات محفظة WLT.
          </Text>
          <Text style={{ color: theme.colorSecondary }}>
            معاينة التنقل لا تسجّل الدخول ولا تمنح أي صلاحية للوصول إلى بيانات الطلبات أو مواقع العملاء.
          </Text>
        </View>
        <Link href="/home" style={{ color: theme.interactiveText, fontSize: 17 }}>معاينة الأقسام دون تسجيل الدخول</Link>
        {__DEV__ ? <Link href="/health" style={{ color: theme.interactiveText }}>فحص الملاحة التجريبي</Link> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
