import { useCallback, useMemo } from "react";
import { Tabs, useRouter } from "expo-router";
import { useColorScheme } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { createFieldTabOptions } from "../../src/shell/field-shell";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };
export default function FieldAppLayout() { const router = useRouter(); const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light"); const tabOptions = useMemo(() => createFieldTabOptions(theme), [theme]); const onUnauthenticated = useCallback(() => router.replace("/"), [router]); return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><Tabs screenOptions={tabOptions}><Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "جاهزية الميدان" }} /><Tabs.Screen name="cases" options={{ title: "الملفات", tabBarAccessibilityLabel: "ملفات الانضمام" }} /><Tabs.Screen name="account" options={{ title: "الحساب", tabBarAccessibilityLabel: "حساب الميدان" }} /><Tabs.Screen name="new-case" options={{ href: null }} /></Tabs></AuthenticatedMobileBoundary>; }
