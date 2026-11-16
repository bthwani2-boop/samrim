import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Tabs } from "expo-router";
import { Platform, useWindowDimensions } from "react-native";
import { merchantNavigationMode } from "../../../src/features/navigation/merchant-navigation-mode";

// A single Expo app: native bottom tabs; on wide Expo Web, right-side navigation.
// This layout does not grant Merchant or Store authority. The parent denies
// entry until owner-verified Identity and DSH Store scope exist.
export default function MerchantTabsLayout() {
  const { theme } = useMobileAppearance();
  const { width } = useWindowDimensions();
  const desktop = merchantNavigationMode(Platform.OS, width) === "desktop";
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarPosition: desktop ? "right" : "bottom",
      tabBarVariant: desktop ? "material" : "uikit",
      tabBarActiveTintColor: theme.interactiveText,
      tabBarInactiveTintColor: theme.colorSecondary,
      tabBarStyle: desktop
        ? { backgroundColor: theme.surface, borderLeftColor: theme.borderColor, width: 220 }
        : { backgroundColor: theme.surface, borderTopColor: theme.borderColor },
    }}>
      <Tabs.Screen name="orders" options={{ title: "الطلبات" }} />
      <Tabs.Screen name="products" options={{ title: "المنتجات" }} />
      <Tabs.Screen name="wallet" options={{ title: "المحفظة" }} />
      <Tabs.Screen name="more" options={{ title: desktop ? "لوحة المتجر" : "المزيد" }} />
    </Tabs>
  );
}
