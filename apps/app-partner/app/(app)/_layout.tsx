import { useCallback, useMemo } from "react";
import { Tabs, useRouter } from "expo-router";
import { useColorScheme } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { createPartnerTabOptions } from "../../src/shell/partner-shell";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function PartnerAppLayout() {
  const router = useRouter();
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const tabOptions = useMemo(() => createPartnerTabOptions(theme), [theme]);
  const onUnauthenticated = useCallback(() => router.replace("/"), [router]);
  return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><Tabs screenOptions={tabOptions}><Tabs.Screen name="store" options={{ title: "المتجر", tabBarAccessibilityLabel: "إدارة المتجر" }} /><Tabs.Screen name="orders" options={{ title: "الطلبات", tabBarAccessibilityLabel: "طلبات المتجر" }} /><Tabs.Screen name="account" options={{ title: "الحساب", tabBarAccessibilityLabel: "حساب الشريك" }} /><Tabs.Screen name="onboarding" options={{ href: null }} /></Tabs></AuthenticatedMobileBoundary>;
}
