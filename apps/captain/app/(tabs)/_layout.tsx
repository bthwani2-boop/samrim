import { usePrimaryNavigation } from "@bthwani/tamagui-config/navigation";
import { Tabs } from "expo-router";
import CaptainProtectedRoute from "../../src/features/access/protected-route";

// Navigation is not Captain authorization: each protected screen denies unavailable owner data.
export default function CaptainTabsLayout() {
  const { screenOptions } = usePrimaryNavigation();
  return (
    <CaptainProtectedRoute>
      <Tabs screenOptions={screenOptions} backBehavior="history">
        <Tabs.Screen name="home" options={{ title: "الرئيسية" }} />
        <Tabs.Screen name="deliveries" options={{ title: "التوصيلات" }} />
        <Tabs.Screen name="wallet" options={{ title: "المحفظة" }} />
        <Tabs.Screen name="account" options={{ title: "حسابي" }} />
      </Tabs>
    </CaptainProtectedRoute>
  );
}
