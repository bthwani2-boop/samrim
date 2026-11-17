import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Tabs } from "expo-router";

// /, /orders and /account retain their URLs. Private features still fail closed.
export default function CustomerTabsLayout() {
  const { theme } = useMobileAppearance();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: theme.interactiveText,
      tabBarInactiveTintColor: theme.colorSecondary,
      tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.borderColor },
    }}>
      <Tabs.Screen name="index" options={{ title: "الرئيسية" }} />
      <Tabs.Screen name="orders" options={{ title: "طلباتي" }} />
      <Tabs.Screen name="account" options={{ title: "حسابي" }} />
    </Tabs>
  );
}
