import { useAppearanceTheme } from "@bthwani/design-system/native";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, Tabs, usePathname, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";
import { PartnerStoreScopeProvider, usePartnerStoreScope } from "../../src/features/partner-onboarding/partner-store-scope-context";
import { createPartnerTabOptions } from "../../src/shell/partner-shell";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function PartnerAppLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const onUnauthenticated = useCallback(() => {
    router.replace(pathname === "/" ? "/" : `/?returnTo=${encodeURIComponent(pathname)}` as Href);
  }, [pathname, router]);
  return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}>
    <PartnerStoreScopeProvider><PartnerTabs /></PartnerStoreScopeProvider>
  </AuthenticatedMobileBoundary>;
}

function PartnerTabs() {
  const theme = useAppearanceTheme();
  const { authority } = usePartnerStoreScope();
  const tabOptions = useMemo(() => createPartnerTabOptions(theme, authority.canUse("orders")), [theme, authority]);
  return <Tabs initialRouteName="orders" screenOptions={tabOptions}>
    <Tabs.Screen name="orders" options={authority.canUse("orders") ? { title: "الطلبات", tabBarAccessibilityLabel: "الطلبات" } : { href: null }} />
    <Tabs.Screen name="products" options={authority.canUse("products") ? { title: "المنتجات", tabBarAccessibilityLabel: "المنتجات" } : { href: null }} />
    <Tabs.Screen name="wallet" options={authority.canUse("wallet") ? { title: "المحفظة", tabBarAccessibilityLabel: "المحفظة" } : { href: null }} />
    <Tabs.Screen name="more" options={{ title: "المزيد", tabBarAccessibilityLabel: "الإدارة والإعدادات" }} />
    <Tabs.Screen name="store" options={{ href: null }} />
    <Tabs.Screen name="account" options={{ href: null }} />
    <Tabs.Screen name="onboarding" options={{ href: null }} />
  </Tabs>;
}
