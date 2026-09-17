import { useCallback, useMemo } from "react";
import { Tabs, useRouter } from "expo-router";
import { useColorScheme } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { createCaptainTabOptions } from "../../src/shell/captain-shell";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };
export default function CaptainAppLayout() { const router = useRouter(); const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light"); const tabOptions = useMemo(() => createCaptainTabOptions(theme), [theme]); const onUnauthenticated = useCallback(() => router.replace("/"), [router]); return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><Tabs screenOptions={tabOptions}><Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "جاهزية الكابتن" }} /><Tabs.Screen name="offers" options={{ title: "العروض", tabBarAccessibilityLabel: "عروض التوصيل" }} /><Tabs.Screen name="deliveries" options={{ title: "التوصيلات", tabBarAccessibilityLabel: "التوصيلات الحالية" }} /><Tabs.Screen name="account" options={{ title: "الحساب", tabBarAccessibilityLabel: "حساب الكابتن" }} /></Tabs></AuthenticatedMobileBoundary>; }
