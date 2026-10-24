import { AppearanceProvider, useMobileAppearance } from "@bthwani/design-system/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { appearance } from "../src/bootstrap/appearance";
import { AppKeyboardProvider } from "../src/bootstrap/keyboard-provider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppKeyboardProvider>
      <AppearanceProvider controller={appearance}>
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
