import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Tabs } from "expo-router";

// Tabs define the future Merchant navigation, not an authorization grant.
export default function MerchantTabsLayout() {
  const { theme } = useMobileAppearance();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: theme.interactiveText,
      tabBarInactiveTintColor: theme.colorSecondary,
      tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.borderColor },
    }}>
      <Tabs.Screen name="orders" options={{ title: "الطلبات" }} />
      <Tabs.Screen name="products" options={{ title: "المنتجات" }} />
      <Tabs.Screen name="wallet" options={{ title: "المحفظة" }} />
      <Tabs.Screen name="more" options={{ title: "المزيد" }} />
    </Tabs>
  );
}
