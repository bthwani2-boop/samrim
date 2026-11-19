import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { usePrimaryNavigation } from "@bthwani/tamagui-config/navigation";
import { Link, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { View } from "react-native";

const destinations = [
  { name: "index", href: "/", title: "الرئيسية" },
  { name: "orders/index", href: "/orders", title: "طلباتي" },
  { name: "account/index", href: "/account", title: "حسابي" },
] as const;

function StorefrontNavigation({ active }: { active: string | undefined }) {
  const { theme } = useMobileAppearance();
  return (
    <View style={{ backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.borderColor }}>
      <View style={{
        width: "100%", maxWidth: 1120, alignSelf: "center", minHeight: 64, paddingHorizontal: 24,
        flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 20,
      }}>
        <Link href="/" accessibilityLabel="بثواني، الرئيسية" style={{
          color: theme.color, fontSize: 25, fontWeight: "800", paddingVertical: 10,
        }}>بثواني</Link>
        <View accessibilityRole="navigation" accessibilityLabel="تنقل بثواني"
          style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {destinations.map(({ name, href, title }) => {
            const selected = name === active;
            return (
              <Link key={name} href={href} aria-current={selected ? "page" : undefined} style={{
                backgroundColor: selected ? theme.actionSoft : "transparent",
                color: selected ? theme.interactiveText : theme.color,
                fontSize: 15, fontWeight: "600", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20,
                textDecorationLine: selected ? "underline" : "none",
              }}>
                {title}
              </Link>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const renderStorefrontNavigation: NonNullable<ComponentProps<typeof Tabs>["tabBar"]> = ({ state }) =>
  <StorefrontNavigation active={state.routes[state.index]?.name} />;

// /, /orders and /account retain their URLs. Private features still fail closed.
export default function CustomerTabsLayout() {
  const { desktop, screenOptions } = usePrimaryNavigation();
  return (
    <Tabs
      screenOptions={desktop ? { ...screenOptions, tabBarPosition: "top", tabBarVariant: "uikit" } : screenOptions}
      {...(desktop ? { tabBar: renderStorefrontNavigation } : {})}
      backBehavior="history"
    >
      {destinations.map(({ name, title }) => <Tabs.Screen key={name} name={name} options={{ title }} />)}
    </Tabs>
  );
}
