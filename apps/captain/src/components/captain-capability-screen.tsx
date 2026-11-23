import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = Readonly<{
  title: string;
  message: string;
  status?: string;
  returnTo?: "/" | "/home";
}>;

export default function CaptainCapabilityScreen({ title, message, status, returnTo }: Props) {
  const { theme } = useMobileAppearance();
  const textStyle = { color: theme.color };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 28, fontWeight: "700" }}>{title}</Text>
          {status ? (
            <Text testID="captain-workspace-status" style={{ color: theme.successText, fontSize: 15, fontWeight: "600" }}>
              {status}
            </Text>
          ) : null}
        </View>
        <View style={{ padding: 20, gap: 8, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 14, backgroundColor: theme.surface }}>
          <Text accessibilityRole="header" testID="captain-capability-unavailable" style={{ color: theme.warningText, fontSize: 18, fontWeight: "600" }}>
            غير متاحة حاليًا
          </Text>
          <Text style={{ ...textStyle, fontSize: 16, lineHeight: 26 }}>{message}</Text>
        </View>
        {returnTo ? (
          <Link href={returnTo} asChild>
            <Pressable accessibilityRole="link" style={{ minHeight: 48, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 14,
              borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor }}>
              <Text style={{ color: theme.interactiveText, fontSize: 16, fontWeight: "600" }}>
                {returnTo === "/" ? "إدارة تسجيل الدخول" : "العودة إلى الرئيسية"}
              </Text>
            </Pressable>
          </Link>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
