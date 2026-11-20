import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useCaptainWorkspace } from "../../src/features/access/protected-route";

export default function CaptainAccountRoute() {
  const { theme } = useMobileAppearance();
  const workspace = useCaptainWorkspace();
  if (!workspace) return null;

  const expires = new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(workspace.session.sessionExpiresAt));
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 28, fontWeight: "700" }}>حسابي</Text>
      <View style={{ gap: 10, padding: 16, borderRadius: 14, borderWidth: 1,
        backgroundColor: theme.surface, borderColor: theme.borderColor }}>
        <Text style={{ color: theme.successText, fontWeight: "700" }}>حساب الكابتن معتمد</Text>
        <Text style={{ color: theme.colorSecondary }}>تنتهي الجلسة الحالية في {expires}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={workspace.signOut}
        style={{ minHeight: 48, paddingHorizontal: 14, justifyContent: "center", alignSelf: "flex-start",
          borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor }}>
        <Text style={{ color: theme.dangerText, fontWeight: "700" }}>تسجيل الخروج</Text>
      </Pressable>
    </ScrollView>
  );
}
