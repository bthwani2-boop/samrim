import { Link } from "expo-router";
import { SafeAreaView, ScrollView } from "react-native";
import { Button, Input, Text, XStack, YStack } from "tamagui";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";

export default function FoundationHome() {
  const { theme, preference, setPreference } = useMobileAppearance();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <YStack style={{ gap: 16, alignItems: "stretch" }} aria-label="فحص البنية الأساسية">
          <Text style={{ color: theme.color, fontSize: 28, fontWeight: "700" }}>بثواني — الكابتن</Text>
          <Text style={{ color: theme.colorSecondary }}>تطبيق تجريبي جاهز لاستقبال الواجهات لاحقًا. لا توجد وظائف تجارية مفعّلة.</Text>
          <Input aria-label="حقل اختبار إدخال عربي" placeholder="اكتب نصًا عربيًا" />
          <Text style={{ color: theme.color }}>المظهر: {preference === "system" ? "حسب النظام" : preference === "light" ? "فاتح" : "داكن"}</Text>
          <XStack style={{ gap: 8, flexWrap: "wrap" }}>
            <Button aria-label="مظهر حسب النظام" onPress={() => void setPreference("system")}>النظام</Button>
            <Button aria-label="المظهر الفاتح" onPress={() => void setPreference("light")}>فاتح</Button>
            <Button aria-label="المظهر الداكن" onPress={() => void setPreference("dark")}>داكن</Button>
          </XStack>
          <Text role="alert" style={{ color: theme.success }}>نجاح: حزم العرض متصلة</Text>
          <Text role="alert" style={{ color: theme.danger }}>مثال خطأ: لا توجد خدمة API في هذه المرحلة</Text>
          <Link href="/health" style={{ color: theme.interactiveText, fontSize: 18 }}>فتح صفحة اختبار الملاحة</Link>
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
