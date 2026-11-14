import type { ReactNode } from "react";
import { SafeAreaView, ScrollView } from "react-native";
import { Button, Input, Text, XStack, YStack } from "tamagui";
import { AppearanceProvider, MobileThemeProvider, useMobileAppearance, useStage4AppearanceController } from "./appearance";
import type { AppearanceStorage } from "./appearance";

// The three Expo Router hosts provide their own route renderer and persistent
// key; this shared Stage-4 shell does not own their navigation or app identity.
export function createStage4Root(
  key: string,
  nativeGetItem: AppearanceStorage["getItem"],
  nativeSetItem: AppearanceStorage["setItem"],
  renderRoutes: (background: string) => ReactNode,
) {
  function Routes() {
    const { theme } = useMobileAppearance();
    return <MobileThemeProvider>{renderRoutes(theme.background)}</MobileThemeProvider>;
  }
  return function RootLayout() {
    const controller = useStage4AppearanceController(key, nativeGetItem, nativeSetItem);
    return <AppearanceProvider controller={controller}><Routes /></AppearanceProvider>;
  };
}

// Temporary Stage-4 presentation probe shared by three Expo hosts.
// Real customer, merchant and captain features remain app-owned.
export function Stage4Preview({
  title,
  healthLink,
  labLink,
}: {
  title: string;
  healthLink: ReactNode;
  labLink?: ReactNode;
}) {
  const { theme, preference, setPreference } = useMobileAppearance();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <YStack style={{ gap: 16, alignItems: "stretch" }} aria-label="فحص البنية الأساسية">
          <Text style={{ color: theme.color, fontSize: 28, fontWeight: "700" }}>{title}</Text>
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
          {healthLink}
          {labLink}
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
