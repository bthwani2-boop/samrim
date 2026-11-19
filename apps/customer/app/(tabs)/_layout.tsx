import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { usePrimaryNavigation } from "@bthwani/tamagui-config/navigation";
import { Link, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";

const destinations = [
  { name: "index", href: "/", title: "الرئيسية" },
  { name: "orders/index", href: "/orders", title: "طلباتي" },
  { name: "account/index", href: "/account", title: "حسابي" },
] as const;

/** Public web storefront navigation; private destinations retain their own gates. */
function StorefrontNavigation({ active }: { active: string | undefined }) {
  const { theme } = useMobileAppearance();
  const linkStyle = (selected: boolean) => ({
    backgroundColor: selected ? theme.actionSoft : "transparent",
    color: selected ? theme.interactiveText : theme.color,
    fontSize: 15,
    fontWeight: selected ? "700" : "600",
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 48,
    borderRadius: 10,
    textDecorationLine: selected ? "underline" : "none",
  } as const);

  return (
    <View style={{
      width: 228, flex: 1, minHeight: "100%",
      backgroundColor: theme.surface, borderLeftWidth: 1,
      borderLeftColor: theme.borderColor, paddingHorizontal: 12, paddingVertical: 20, gap: 20,
    }}>
      <Link href="/" accessibilityLabel="بثواني، الرئيسية" style={{
        color: theme.color, fontSize: 25, fontWeight: "800", paddingHorizontal: 12, paddingVertical: 10,
      }}>بثواني</Link>
      <View accessibilityRole="navigation" accessibilityLabel="تنقل بثواني"
        style={{ gap: 5 }}>
        <Text style={{ color: theme.colorSecondary, fontWeight: "700", paddingHorizontal: 14, paddingBottom: 5 }}>
          الأقسام الأساسية
        </Text>
        {destinations.map(({ name, href, title }) => {
          const selected = name === active;
          return (
            <Link key={name} href={href} aria-current={selected ? "page" : undefined}
              style={linkStyle(selected)}>
              {title}
            </Link>
          );
        })}
        <Link href="/stores" style={linkStyle(false)}>المتاجر</Link>
      </View>
      <Text style={{ color: theme.colorSecondary, fontSize: 13, paddingHorizontal: 12, textAlign: "auto" }}>
        عرض المتاجر متاح للجميع. الطلبات والحساب يتطلبان التحقق من الهوية.
      </Text>
    </View>
  );
}

const renderStorefrontNavigation: NonNullable<ComponentProps<typeof Tabs>["tabBar"]> = ({ state }) =>
  <StorefrontNavigation active={state.routes[state.index]?.name} />;

// /, /orders and /account retain their URLs and native bottom tabs. Private
// features still enforce owner Identity and data-level permission checks.
export default function CustomerTabsLayout() {
  const { desktop, screenOptions } = usePrimaryNavigation();
  return (
    <Tabs
      screenOptions={desktop ? { ...screenOptions, tabBarPosition: "left", tabBarVariant: "material" } : screenOptions}
      {...(desktop ? { tabBar: renderStorefrontNavigation } : {})}
      backBehavior="history"
    >
      {destinations.map(({ name, title }) => <Tabs.Screen key={name} name={name} options={{ title }} />)}
    </Tabs>
  );
}
