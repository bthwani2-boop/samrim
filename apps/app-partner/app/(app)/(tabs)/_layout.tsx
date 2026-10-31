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
  const { authority } = usePartnerStoreScope();
  const tabOptions = useMemo(() => createPartnerTabOptions(theme, authority.canUse("orders"), desktopWeb), [theme, authority, desktopWeb]);
  return <Tabs screenOptions={tabOptions}>
    <Tabs.Screen name="orders" options={authority.canUse("orders") ? { title: "الطلبات", tabBarAccessibilityLabel: "الطلبات" } : { href: null }} />
    <Tabs.Screen name="products" listeners={{ tabPress: (event) => { event.preventDefault(); dispatchPartnerProductAction("list"); router.replace("/products" as Href); } }} options={authority.canUse("products") ? { title: "المنتجات", tabBarAccessibilityLabel: "المنتجات" } : { href: null }} />
    <Tabs.Screen name="wallet" options={authority.canUse("wallet") ? { title: "المحفظة", tabBarAccessibilityLabel: "المحفظة" } : { href: null }} />
    <Tabs.Screen name="more" options={{ title: desktopWeb ? "لوحة المتجر" : "المزيد", tabBarAccessibilityLabel: desktopWeb ? "لوحة المتجر" : "الإدارة والإعدادات" }} />
  </Tabs>;
}
