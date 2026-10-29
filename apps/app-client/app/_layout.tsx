import { AppearanceProvider, BthwaniNetworkStatusNotice, useMobileAppearance } from "@bthwani/design-system/native";
import { useNetworkState } from "expo-network";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { appearance } from "../src/bootstrap/appearance";
import { currentIdentityState, subscribeIdentitySession } from "../src/bootstrap/identity";

function currentMobileActorID(): string {
  const session = currentIdentityState();
  return session.kind === "authenticated" ? session.identity.subject.trim() : "";
}
import { AppKeyboardProvider } from "../src/bootstrap/keyboard-provider";
import { OrderAlertMonitor } from "../src/features/notifications/order-alert-monitor";
import ServiceCityScope from "../src/features/service-city/service-city-scope";

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
        <ServiceCityScope><RootNavigation /></ServiceCityScope>
        <RootNetworkNotice />
      </AppearanceProvider>
      </AppKeyboardProvider>
    </SafeAreaProvider>
  );
}

function RootNavigation() {
  const { themeName, theme } = useMobileAppearance();
  // A new session actor must not inherit React screen state or previous responses.
  const actorID = useSyncExternalStore(subscribeIdentitySession, currentMobileActorID, () => "");
  return <><StatusBar style={themeName === "dark" ? "light" : "dark"} /><Stack key={actorID || "signed-out"} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}><Stack.Screen name="notifications" options={{ headerShown: false }} /></Stack></>;
}

function RootNetworkNotice() {
  const { top } = useSafeAreaInsets();
  const { isConnected, isInternetReachable } = useNetworkState();
  return <BthwaniNetworkStatusNotice top={top} offline={isConnected === false && isInternetReachable === false} />;
}
