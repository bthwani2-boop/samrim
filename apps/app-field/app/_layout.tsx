import { AppearanceProvider, useMobileAppearance } from "@bthwani/design-system/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { appearance } from "../src/bootstrap/appearance";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppearanceProvider controller={appearance}>
        <RootNavigation />
      </AppearanceProvider>
    </SafeAreaProvider>
  );
}

function RootNavigation() {
  const { themeName } = useMobileAppearance();
  return <><StatusBar style={themeName === "dark" ? "light" : "dark"} /><Stack screenOptions={{ headerShown: false }}><Stack.Screen name="notifications" options={{ headerShown: false }} /></Stack></>;
}
