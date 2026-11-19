import { usePrimaryNavigation } from "@bthwani/tamagui-config/navigation";
import { Tabs } from "expo-router";

// /, /orders and /account retain their URLs. Private features still fail closed.
export default function CustomerTabsLayout() {
  const { screenOptions } = usePrimaryNavigation();
  return (
    <Tabs screenOptions={screenOptions} backBehavior="history">
      <Tabs.Screen name="index" options={{ title: "الرئيسية" }} />
      <Tabs.Screen name="orders/index" options={{ title: "طلباتي" }} />
      <Tabs.Screen name="account/index" options={{ title: "حسابي" }} />
    </Tabs>
  );
}
