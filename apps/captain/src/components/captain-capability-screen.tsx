import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { SafeAreaView, ScrollView, Text, View } from "react-native";

type Props = Readonly<{ title: string; message: string }>;

export default function CaptainCapabilityScreen({ title, message }: Props) {
  const { theme } = useMobileAppearance();
  const textStyle = { color: theme.color };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" }}>
        <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 26, fontWeight: "700" }}>{title}</Text>
        <View style={{ padding: 20, gap: 12, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 14, backgroundColor: theme.surface }}>
          <Text accessibilityRole="alert" testID="captain-capability-unavailable" style={{ color: theme.warningText, fontSize: 18, fontWeight: "600" }}>
            هذه الوظيفة غير مفعّلة حاليًا.
          </Text>
          <Text style={{ ...textStyle, fontSize: 16, lineHeight: 26 }}>{message}</Text>
          <Text style={{ color: theme.colorSecondary }}>
            لا توجد جلسة كابتن معتمدة في التطبيق الحالي؛ لن تُعرض مهام خاصة أو تُقبل عروض أو تُسجّل حركة نقدية دون تأكيد الخدمات المالكة.
          </Text>
        </View>
        <Text style={{ ...textStyle, fontSize: 17, fontWeight: "600" }}>الأقسام الرئيسية</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
          <Link href="/home" style={{ color: theme.interactiveText, fontSize: 16 }}>الرئيسية</Link>
          <Link href="/deliveries" style={{ color: theme.interactiveText, fontSize: 16 }}>التوصيلات</Link>
          <Link href="/wallet" style={{ color: theme.interactiveText, fontSize: 16 }}>المحفظة</Link>
          <Link href="/account" style={{ color: theme.interactiveText, fontSize: 16 }}>حسابي</Link>
        </View>
        <Link href="/" style={{ color: theme.interactiveText, fontSize: 16 }}>العودة لبوابة الكابتن</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
