import { useAppearanceTheme } from "@bthwani/design-system/native";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, Tabs, usePathname, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";
import { createFieldTabOptions } from "../../src/shell/field-shell";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };
export default function FieldAppLayout() { const router = useRouter(); const pathname = usePathname(); const theme = useAppearanceTheme(); const tabOptions = useMemo(() => createFieldTabOptions(theme), [theme]); const onUnauthenticated = useCallback(() => router.replace(pathname === "/" ? "/" : `/?returnTo=${encodeURIComponent(pathname)}` as Href), [pathname, router]); return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><Tabs screenOptions={tabOptions} screenListeners={({ route }) => ({ tabPress: (event) => { const path = route.name === "home" ? "/(app)/home" : route.name === "cases" ? "/(app)/cases" : route.name === "account" ? "/(app)/account" : null; if (!path) return; event.preventDefault(); router.replace(path as Href); } })}><Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "جاهزية الميدان" }} /><Tabs.Screen name="cases" options={{ title: "الملفات", tabBarAccessibilityLabel: "ملفات الانضمام" }} /><Tabs.Screen name="account" options={{ title: "الحساب", tabBarAccessibilityLabel: "حساب الميدان" }} /><Tabs.Screen name="new-case" options={{ href: null }} /></Tabs></AuthenticatedMobileBoundary>; }
