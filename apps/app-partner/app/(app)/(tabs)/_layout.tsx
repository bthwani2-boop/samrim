import { useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, Tabs, useRouter } from "expo-router";
import { useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { usePartnerStoreScope } from "../../../src/features/partner-onboarding/partner-store-scope-context";
import { createPartnerTabOptions } from "../../../src/shell/partner-shell";
import { dispatchPartnerProductAction } from "../../../src/shell/partner-product-actions";
export default function PartnerTabsLayout() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const { width } = useWindowDimensions();
  const desktopWeb = Platform.OS === "web" && width >= 1024;
  const { authority, state } = usePartnerStoreScope();
  // Keep routes addressable until Store authority resolves; PartnerSurfaceGate
  // hides protected content while pending/error and redirects on confirmed denial.
  // Setting href:null during loading would discard an authorized deep link.
  const tabOptions = useMemo(() => createPartnerTabOptions(theme, authority.canUse("orders"), desktopWeb), [theme, authority, desktopWeb]);
  return <Tabs screenOptions={tabOptions}>
    <Tabs.Screen name="orders" options={state.kind === "ready" && !authority.canUse("orders") ? { href: null } : { title: "الطلبات", tabBarAccessibilityLabel: "الطلبات" }} />
    <Tabs.Screen name="products" listeners={{ tabPress: (event) => { event.preventDefault(); dispatchPartnerProductAction("list"); router.replace("/products" as Href); } }} options={state.kind === "ready" && !authority.canUse("products") ? { href: null } : { title: "المنتجات", tabBarAccessibilityLabel: "المنتجات" }} />
    <Tabs.Screen name="wallet" options={state.kind === "ready" && !authority.canUse("wallet") ? { href: null } : { title: "المحفظة", tabBarAccessibilityLabel: "المحفظة" }} />
    <Tabs.Screen name="more" options={{ title: desktopWeb ? "لوحة المتجر" : "المزيد", tabBarAccessibilityLabel: desktopWeb ? "لوحة المتجر" : "الإدارة والإعدادات" }} />
  </Tabs>;
}
