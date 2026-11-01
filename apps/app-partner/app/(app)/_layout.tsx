import { useAppearanceTheme } from "@bthwani/design-system/native";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, Stack, usePathname, useRouter } from "expo-router";
import { useCallback } from "react";
import { Platform, useWindowDimensions } from "react-native";

import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";
import { PartnerStoreScopeProvider } from "../../src/features/partner-onboarding/partner-store-scope-context";
import { PartnerDesktopWorkspace } from "../../src/shell/partner-desktop-workspace";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function PartnerAppLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const onUnauthenticated = useCallback(
    () => router.replace(`/?returnTo=${encodeURIComponent(pathname)}` as Href),
    [pathname, router],
  );

  return (
    <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}>
      <PartnerStoreScopeProvider>
        <PartnerDesktopWorkspace><PartnerStack /></PartnerDesktopWorkspace>
      </PartnerStoreScopeProvider>
    </AuthenticatedMobileBoundary>
  );
}

function PartnerStack() {
  const theme = useAppearanceTheme();
  const { width } = useWindowDimensions();
  const desktopWeb = Platform.OS === "web" && width >= 1024;
  const screenOptions = {
    headerShown: true,
    headerStyle: { backgroundColor: theme.surface },
    headerTintColor: theme.color,
    contentStyle: { backgroundColor: theme.background },
  };

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="store" options={{ ...screenOptions, title: "المتجر" }} />
      <Stack.Screen name="employees" options={desktopWeb ? { headerShown: false } : { ...screenOptions, title: "الموظفين" }} />
      <Stack.Screen name="insights" options={{ ...screenOptions, title: "الأداء" }} />
      <Stack.Screen name="account" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ ...screenOptions, title: "التجهيز" }} />
    </Stack>
  );
}
