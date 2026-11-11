import { parseStudioThemePublication } from "@bthwani/design-system";
import { AppearanceProvider, BthwaniNetworkStatusNotice, isConfirmedOffline, useMobileAppearance } from "@bthwani/design-system/native";
import { AppKeyboardProvider } from "@bthwani/design-system/native/keyboard-provider";
import { tamaguiConfig } from "@bthwani/tamagui-config";
import { useNetworkState } from "expo-network";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { TamaguiProvider } from "tamagui";

import { appearance } from "../src/bootstrap/appearance";
import { createClientDsh } from "../src/bootstrap/dsh";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../src/bootstrap/identity";
import { clientSessionKey } from "../src/features/access/client-session-scope";
import { OrderAlertMonitor } from "../src/features/notifications/order-alert-monitor";
import ServiceCityScope from "../src/features/service-city/service-city-scope";

function currentClientNavigationSessionKey(): string {
  return clientSessionKey(currentIdentityState());
}

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === "web") {
      // All deep links need cookie-session restoration, not only the login page.
      // IdentitySessionManager deduplicates concurrent restoration requests.
      void restoreIdentitySession().catch(() => { /* State owner exposes retry/error. */ });
    }
  }, []);
  useEffect(() => {
    const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!baseUrl) return;
    let mounted = true;
    let latestRequest = 0;
    const api = createClientDsh();
    const refresh = () => {
      const requestId = ++latestRequest;
      void Promise.resolve().then(() => api.readPublicStudioTheme()).then((value) => {
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
  // No private screen state survives an actor switch or renewed same-actor session.
  const sessionKey = useSyncExternalStore(subscribeIdentitySession, currentClientNavigationSessionKey, () => "");
  return <TamaguiProvider config={tamaguiConfig} defaultTheme={themeName}><StatusBar style={themeName === "dark" ? "light" : "dark"} /><Stack key={sessionKey || "signed-out"} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}><Stack.Screen name="notifications" options={{ headerShown: false }} /></Stack></TamaguiProvider>;
}

function RootNetworkNotice() {
  const { top } = useSafeAreaInsets();
  const { isConnected, isInternetReachable } = useNetworkState();
  return <BthwaniNetworkStatusNotice top={top} offline={isConfirmedOffline(isConnected, isInternetReachable)} />;
}
