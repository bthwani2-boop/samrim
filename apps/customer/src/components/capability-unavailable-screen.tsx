import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { SafeAreaView, ScrollView, Text, View } from "react-native";

type Props = Readonly<{ title: string; message: string }>;

export default function CapabilityUnavailableScreen({ title, message }: Props) {
  const { theme } = useMobileAppearance();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 26, fontWeight: "700" }}>{title}</Text>
        <View style={{ padding: 20, borderRadius: 14, borderWidth: 1, borderColor: theme.borderColor, backgroundColor: theme.surface, gap: 12 }}>
          <Text accessibilityRole="alert" testID="capability-not-ready" style={{ color: theme.warningText, fontSize: 18, fontWeight: "600" }}>
            هذه الخدمة غير مفعّلة حاليًا.
          </Text>
          <Text style={{ color: theme.color, fontSize: 16, lineHeight: 26 }}>{message}</Text>
          <Text style={{ color: theme.colorSecondary }}>
            لن يُرسل هذا القسم طلبًا أو يعدّل حسابًا أو رصيدًا قبل اكتمال التكامل مع الخدمة المختصة.
          </Text>
        </View>
        <Link href="/" style={{ color: theme.interactiveText, fontSize: 17 }}>العودة للرئيسية</Link>
        <Link href="/stores" style={{ color: theme.interactiveText, fontSize: 17 }}>استعراض المتاجر المتاحة</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
