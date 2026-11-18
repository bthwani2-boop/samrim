import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Tabs } from "expo-router";
import CaptainProtectedRoute from "../../src/features/access/protected-route";

// Navigation is not Captain authorization: each protected screen denies unavailable owner data.
export default function CaptainTabsLayout() {
  const { theme } = useMobileAppearance();
  return (
    <CaptainProtectedRoute>
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: theme.interactiveText,
      tabBarInactiveTintColor: theme.colorSecondary,
      tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.borderColor },
    }}>
      <Tabs.Screen name="home" options={{ title: "الرئيسية" }} />
      <Tabs.Screen name="deliveries" options={{ title: "التوصيلات" }} />
      <Tabs.Screen name="wallet" options={{ title: "المحفظة" }} />
      <Tabs.Screen name="account" options={{ title: "حسابي" }} />
    </Tabs>
    </CaptainProtectedRoute>
  );
}
