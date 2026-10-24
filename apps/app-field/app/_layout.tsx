import { AppearanceProvider, BthwaniNetworkStatusNotice, useMobileAppearance } from "@bthwani/design-system/native";
import { useNetworkState } from "expo-network";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { appearance } from "../src/bootstrap/appearance";
import { AppKeyboardProvider } from "../src/bootstrap/keyboard-provider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppKeyboardProvider>
      <AppearanceProvider controller={appearance}>
        <RootNavigation />
        <RootNetworkNotice />
      </AppearanceProvider>
      </AppKeyboardProvider>
    </SafeAreaProvider>
  );
}

function RootNavigation() {
  const { themeName } = useMobileAppearance();
  return <><StatusBar style={themeName === "dark" ? "light" : "dark"} /><Stack screenOptions={{ headerShown: false }}><Stack.Screen name="notifications" options={{ headerShown: false }} /></Stack></>;
}

function RootNetworkNotice() {
  const { top } = useSafeAreaInsets();
  const { isConnected, isInternetReachable } = useNetworkState();
  return <BthwaniNetworkStatusNotice top={top} offline={isConnected === false || isInternetReachable === false} />;
}
