import { useCallback, useMemo } from "react";
import { Tabs, type Href, usePathname, useRouter } from "expo-router";

import { useAppearanceTheme } from "@bthwani/design-system/native";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import ServiceCityScope from "../../src/features/service-city/service-city-scope";
import { createClientTabOptions } from "../../src/shell/client-shell";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function ClientAppLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const theme = useAppearanceTheme();
  const tabOptions = useMemo(() => createClientTabOptions(theme), [theme]);
  const onUnauthenticated = useCallback(() => {
    router.replace(pathname === "/" ? "/" : `/?returnTo=${encodeURIComponent(pathname)}` as Href);
  }, [pathname, router]);
  return (
    <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}>
      <ServiceCityScope>
        <Tabs screenOptions={tabOptions}>
          <Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "الرئيسية" }} />
          <Tabs.Screen name="orders" options={{ title: "الطلبات", tabBarAccessibilityLabel: "الطلبات" }} />
          <Tabs.Screen name="account" options={{ title: "الحساب", tabBarAccessibilityLabel: "الحساب" }} />
          <Tabs.Screen name="cart/[storeId]" options={{ href: null }} />
          <Tabs.Screen name="orders/[orderId]" options={{ href: null }} />
        </Tabs>
      </ServiceCityScope>
    </AuthenticatedMobileBoundary>
  );
}
