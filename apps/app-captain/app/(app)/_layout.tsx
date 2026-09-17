import { useCallback, useMemo } from "react";
import { Tabs, type Href, usePathname, useRouter } from "expo-router";

import { useAppearanceTheme } from "@bthwani/design-system/native";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { createCaptainTabOptions } from "../../src/shell/captain-shell";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };
export default function CaptainAppLayout() { const router = useRouter(); const pathname = usePathname(); const theme = useAppearanceTheme(); const tabOptions = useMemo(() => createCaptainTabOptions(theme), [theme]); const onUnauthenticated = useCallback(() => router.replace(pathname === "/" ? "/" : `/?returnTo=${encodeURIComponent(pathname)}` as Href), [pathname, router]); return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><Tabs screenOptions={tabOptions}><Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "جاهزية الكابتن" }} /><Tabs.Screen name="offers" options={{ title: "العروض", tabBarAccessibilityLabel: "عروض التوصيل" }} /><Tabs.Screen name="deliveries" options={{ title: "التوصيلات", tabBarAccessibilityLabel: "التوصيلات الحالية" }} /><Tabs.Screen name="account" options={{ title: "الحساب", tabBarAccessibilityLabel: "حساب الكابتن" }} /></Tabs></AuthenticatedMobileBoundary>; }
