import { useAppearanceTheme } from "@bthwani/design-system/native";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, Tabs, usePathname, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";
import ServiceCityScope from "../../src/features/service-city/service-city-scope";
import { createClientTabOptions } from "../../src/shell/client-shell";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function ClientAppLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const theme = useAppearanceTheme();
  const tabOptions = useMemo(() => createClientTabOptions(theme), [theme]);
  const onUnauthenticated = useCallback(() => {
    router.replace(pathname === "/" ? "/" : `/?returnTo=${encodeURIComponent(pathname)}` as Href);
  }, [pathname, router]);
  const tabs = (
    <Tabs screenOptions={tabOptions} screenListeners={({ route }) => ({ tabPress: (event) => { const path = route.name === "home" ? "/(app)/home" : route.name === "orders" ? "/(app)/orders" : route.name === "account" ? "/(app)/account" : null; if (!path) return; event.preventDefault(); router.replace(path as Href); } })}>
      <Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "الرئيسية" }} />
      <Tabs.Screen name="orders" options={{ title: "الطلبات", tabBarAccessibilityLabel: "الطلبات" }} />
      <Tabs.Screen name="account" options={{ title: "الحساب", tabBarAccessibilityLabel: "الحساب" }} />
      <Tabs.Screen name="cart/[storeId]" options={{ href: null }} />
      <Tabs.Screen name="orders/[orderId]" options={{ href: null }} />
    </Tabs>
  );
  const requiresAuthentication = pathname === "/orders" || pathname.startsWith("/orders/") || pathname.startsWith("/cart/");
  return (
    <ServiceCityScope>
      {requiresAuthentication ? <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}>{tabs}</AuthenticatedMobileBoundary> : tabs}
    </ServiceCityScope>
  );
}
