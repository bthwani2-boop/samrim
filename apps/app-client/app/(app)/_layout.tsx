import { useAppearanceTheme } from "@bthwani/design-system/native";
import { Tabs } from "expo-router";
import { useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { createClientTabOptions } from "../../src/shell/client-shell";

export default function ClientAppLayout() {
  const theme = useAppearanceTheme();
  const { width } = useWindowDimensions();
  const desktopWeb = Platform.OS === "web" && width >= 1024;
  const tabOptions = useMemo(() => createClientTabOptions(theme, desktopWeb), [theme, desktopWeb]);
  const tabs = (
    <Tabs screenOptions={tabOptions}>
      <Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "الرئيسية" }} />
      <Tabs.Screen name="orders" options={{ headerShown: false, tabBarStyle: { display: "none" }, title: "الطلبات", tabBarAccessibilityLabel: "الطلبات" }} />
      <Tabs.Screen name="account" options={{ title: "الحساب", tabBarAccessibilityLabel: "الحساب" }} />
    </Tabs>
  );
  return tabs;
}
