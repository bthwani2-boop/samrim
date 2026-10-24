import { AppearanceProvider, useMobileAppearance } from "@bthwani/design-system/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { appearance } from "../src/bootstrap/appearance";
import { AppKeyboardProvider } from "../src/bootstrap/keyboard-provider";
import { OrderAlertMonitor } from "../src/features/notifications/order-alert-monitor";

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === "web") {
      document.documentElement.lang = "ar";
      document.documentElement.dir = "rtl";
    }
  }, []);
  return (
    <SafeAreaProvider>
      <AppKeyboardProvider>
      <AppearanceProvider controller={appearance}>
        <OrderAlertMonitor />
        <RootNavigation />
      </AppearanceProvider>
      </AppKeyboardProvider>
    </SafeAreaProvider>
  );
}

function RootNavigation() {
  const { themeName } = useMobileAppearance();
  return <><StatusBar style={themeName === "dark" ? "light" : "dark"} /><Stack screenOptions={{ headerShown: false }}><Stack.Screen name="notifications" options={{ headerShown: false }} /></Stack></>;
}
