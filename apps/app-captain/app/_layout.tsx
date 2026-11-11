import { parseStudioThemePublication } from "@bthwani/design-system";
import { AppearanceProvider, BthwaniNetworkStatusNotice, useMobileAppearance } from "@bthwani/design-system/native";
import { createDshMobileClient } from "@bthwani/dsh";
import { tamaguiConfig } from "@bthwani/tamagui-config";
import { useNetworkState } from "expo-network";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { TamaguiProvider } from "tamagui";

import { appearance } from "../src/bootstrap/appearance";
import { captainSessionKey } from "../src/bootstrap/captain-session-scope";
import { currentIdentityState, subscribeIdentitySession } from "../src/bootstrap/identity";
import { CaptainMissionLocationPublisher } from "../src/features/captain-operations/captain-mission-location-publisher";
import { CaptainPresencePublisher } from "../src/features/captain-operations/captain-presence-publisher";
import { OrderAlertMonitor } from "../src/features/notifications/order-alert-monitor";


function currentCaptainNavigationSessionKey(): string {
  return captainSessionKey(currentIdentityState());
}


export default function RootLayout() {
  useEffect(() => {
    const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!baseUrl) return;
    let mounted = true;
    let latestRequest = 0;
    const api = createDshMobileClient(baseUrl);
    const refresh = () => {
      const requestId = ++latestRequest;
      void api.readPublicStudioTheme().then((value) => {
        if (!mounted || requestId !== latestRequest) return;
        const published = parseStudioThemePublication(value);
        // Unknown schemas or invalid palettes never replace compiled defaults.
        appearance.setPublishedPalette(published?.palette ?? null);
      }).catch(() => { /* Offline: retain last validated theme or compiled defaults. */ });
    };
    refresh();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => { mounted = false; latestRequest++; subscription.remove(); };
  }, []);
  return (
    <SafeAreaProvider>
      <AppearanceProvider controller={appearance}>
        <OrderAlertMonitor />
        <CaptainPresencePublisher />
        <CaptainMissionLocationPublisher />
        <RootNavigation />
        <RootNetworkNotice />
      </AppearanceProvider>
    </SafeAreaProvider>
  );
}

function RootNavigation() {
  const { themeName, theme } = useMobileAppearance();
  // Remount private navigation even when the same Captain authenticates in a new Identity session.
  const sessionKey = useSyncExternalStore(subscribeIdentitySession, currentCaptainNavigationSessionKey, () => "");
  return <TamaguiProvider config={tamaguiConfig} defaultTheme={themeName}><StatusBar style={themeName === "dark" ? "light" : "dark"} /><Stack key={sessionKey || "signed-out"} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}><Stack.Screen name="(app)" /><Stack.Screen name="offers" options={{ presentation: "card" }} /><Stack.Screen name="notifications" options={{ headerShown: false, presentation: "card" }} /></Stack></TamaguiProvider>;
}

function RootNetworkNotice() {
  const { top } = useSafeAreaInsets();
  const { isConnected, isInternetReachable } = useNetworkState();
  return <BthwaniNetworkStatusNotice top={top} offline={isConnected === false || isInternetReachable === false} />;
}
