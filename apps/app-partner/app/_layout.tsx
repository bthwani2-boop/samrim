import { parseStudioThemePublication } from "@bthwani/design-system";
import { createDshMobileClient } from "@bthwani/dsh";
import { AppearanceProvider, BthwaniNetworkStatusNotice, useMobileAppearance } from "@bthwani/design-system/native";
import { QueryClientProvider } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { appearance } from "../src/bootstrap/appearance";
import { createPartnerActorQueryClient } from "../src/bootstrap/actor-query-client";
import { currentIdentityState, subscribeIdentitySession } from "../src/bootstrap/identity";

function currentMobileActorID(): string {
  const session = currentIdentityState();
  return session.kind === "authenticated" ? session.identity.subject.trim() : "";
}
import { AppKeyboardProvider } from "../src/bootstrap/keyboard-provider";
import { OrderAlertMonitor } from "../src/features/notifications/order-alert-monitor";

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
  const actorID = useSyncExternalStore(subscribeIdentitySession, currentMobileActorID, () => "");
  // Remounting this boundary replaces the query client and the entire navigation tree.
  return <PartnerActorNavigation key={actorID || "signed-out"} actorID={actorID} themeName={themeName} />;
}

function PartnerActorNavigation({ actorID, themeName }: { actorID: string; themeName: "light" | "dark" | "system" }) {
  const [queryClient] = useState(createPartnerActorQueryClient);
  useEffect(() => () => { queryClient.clear(); }, [queryClient]);
  return <QueryClientProvider client={queryClient}>
    <StatusBar style={themeName === "dark" ? "light" : "dark"} />
    <Stack key={actorID || "signed-out"} screenOptions={{ headerShown: false }} />
  </QueryClientProvider>;
}

function RootNetworkNotice() {
  const { top } = useSafeAreaInsets();
  const { isConnected, isInternetReachable } = useNetworkState();
  return <BthwaniNetworkStatusNotice top={top} offline={isConnected === false && isInternetReachable === false} />;
}
