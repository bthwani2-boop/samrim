import { Link } from "expo-router";
import { SafeAreaView } from "react-native";
import { Text, YStack } from "tamagui";
import { useMobileAppearance } from "@bthwani/design-system/native/appearance";

export default function HealthRoute() {
  const { theme } = useMobileAppearance();
  return <SafeAreaView style={{ flex: 1, direction: "rtl", backgroundColor: theme.background }}>
    <YStack style={{ padding: 20, gap: 12 }}>
      <Text style={{ color: theme.color, textAlign: "right", fontSize: 22 }}>الملاحة التجريبية تعمل</Text>
      <Link href="/" style={{ textAlign: "right", color: theme.interactiveText }}>العودة للرئيسية</Link>
    </YStack>
  </SafeAreaView>;
}
