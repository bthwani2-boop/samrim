import { parseStudioThemePublication } from "@bthwani/design-system";
import { AppearanceProvider, BthwaniNetworkStatusNotice, isConfirmedOffline, useMobileAppearance } from "@bthwani/design-system/native";
import { AppKeyboardProvider } from "@bthwani/design-system/native/keyboard-provider";
import { createDshMobileClient } from "@bthwani/dsh";
import { tamaguiConfig } from "@bthwani/tamagui-config";
import { QueryClientProvider } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { TamaguiProvider } from "tamagui";
import { createPartnerActorQueryClient } from "../src/bootstrap/actor-query-client";
import { appearance } from "../src/bootstrap/appearance";
import { currentIdentityState, subscribeIdentitySession } from "../src/bootstrap/identity";
import { OrderAlertMonitor } from "../src/features/notifications/order-alert-monitor";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope";

function currentPartnerSessionScope(): string {
  return partnerSetupSessionKey(currentIdentityState());
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
        <RootNavigation />
        <RootNetworkNotice />
      </AppearanceProvider>
      </AppKeyboardProvider>
    </SafeAreaProvider>
  );
}

function RootNavigation() {
  const { themeName } = useMobileAppearance();
  const sessionScope = useSyncExternalStore(subscribeIdentitySession, currentPartnerSessionScope, () => "");
  // Remount all private navigation and query data on same-actor session replacement.
  return <PartnerActorNavigation key={sessionScope || "signed-out"} sessionScope={sessionScope} themeName={themeName} />;
}

function PartnerActorNavigation({ sessionScope, themeName }: { sessionScope: string; themeName: "light" | "dark" }) {
  const [queryClient] = useState(createPartnerActorQueryClient);
  useEffect(() => () => { queryClient.clear(); }, [queryClient]);
  return <TamaguiProvider config={tamaguiConfig} defaultTheme={themeName}><QueryClientProvider client={queryClient}>
    <StatusBar style={themeName === "dark" ? "light" : "dark"} />
    <Stack key={sessionScope || "signed-out"} screenOptions={{ headerShown: false }} />
  </QueryClientProvider></TamaguiProvider>;
}

function RootNetworkNotice() {
  const { top } = useSafeAreaInsets();
  const { isConnected, isInternetReachable } = useNetworkState();
  return <BthwaniNetworkStatusNotice top={top} offline={isConfirmedOffline(isConnected, isInternetReachable)} />;
}
