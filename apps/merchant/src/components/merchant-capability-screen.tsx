import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { SafeAreaView, Text, View } from "react-native";

type Props = Readonly<{ title: string; message: string }>;

// No owner-side operation can be performed from this pending presentation route.
export default function MerchantCapabilityScreen({ title, message }: Props) {
  const { theme } = useMobileAppearance();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, padding: 24, gap: 14 }}>
        <Text accessibilityRole="header" style={{ fontSize: 25, fontWeight: "700", color: theme.color }}>{title}</Text>
        <Text accessibilityRole="alert" style={{ color: theme.warningText, fontSize: 18 }}>هذه الوظيفة غير مفعّلة حاليًا.</Text>
        <Text style={{ color: theme.color, lineHeight: 26 }}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}
