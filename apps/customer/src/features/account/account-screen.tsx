import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AccountPreferences from "./account-preferences";
import StoreInvitations from "./store-invitations";

export default function AccountScreen() {
  const { theme } = useMobileAppearance();
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{
        width: "100%", maxWidth: 720, alignSelf: "center", padding: 16, gap: 16,
      }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 26, fontWeight: "700" }}>حسابي</Text>
        <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor,
          borderRadius: 12, padding: 16, gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 18, fontWeight: "700" }}>
            تسجيل الدخول
          </Text>
          <Link href="/login" asChild>
            <Pressable accessibilityRole="link" style={{
              backgroundColor: theme.actionBackground, borderRadius: 10,
              minHeight: 44, paddingHorizontal: 14, justifyContent: "center",
            }}>
              <Text style={{ color: theme.onAction, fontWeight: "700", textAlign: "center" }}>التحقق من الحساب</Text>
            </Pressable>
          </Link>
        </View>
        <Link href="/wallet" asChild>
          <Pressable accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center", padding: 12,
            backgroundColor: theme.actionSoft, borderRadius: 10 }}>
            <Text style={{ color: theme.interactiveText }}>محفظتي</Text>
          </Pressable>
        </Link>
        <Link href="/addresses" asChild><Pressable accessibilityRole="link" style={{ minHeight:44, justifyContent:"center", padding:12, backgroundColor:theme.actionSoft, borderRadius:10 }}>
          <Text style={{ color:theme.interactiveText }}>عناويني</Text>
        </Pressable></Link>
        <Link href={{ pathname: "/stores", params: { chooseCity: "1" } }} asChild>
          <Pressable accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center", padding: 12,
            backgroundColor: theme.actionSoft, borderRadius: 10 }}>
            <Text style={{ color: theme.interactiveText }}>تغيير مدينة التسوّق</Text>
          </Pressable>
        </Link>
        <AccountPreferences />
        <StoreInvitations />
      </ScrollView>
    </SafeAreaView>
  );
}
