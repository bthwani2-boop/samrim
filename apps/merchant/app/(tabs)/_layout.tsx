import { usePrimaryNavigation } from "@bthwani/tamagui-config/navigation";
import { Tabs } from "expo-router";

// A single Expo app: native bottom tabs; on wide Expo Web, right-side navigation.
// This layout does not grant Merchant or Store authority. The parent denies
// entry until owner-verified Identity and DSH Store scope exist.
export default function MerchantTabsLayout() {
  const { desktop, screenOptions } = usePrimaryNavigation();
  return (
    <Tabs screenOptions={screenOptions} backBehavior="history">
      <Tabs.Screen name="orders/index" options={{ title: "الطلبات" }} />
      <Tabs.Screen name="products/index" options={{ title: "المنتجات" }} />
      <Tabs.Screen name="wallet/index" options={{ title: "المحفظة" }} />
      <Tabs.Screen name="more/index" options={{ title: desktop ? "لوحة المتجر" : "المزيد" }} />
    </Tabs>
  );
}
