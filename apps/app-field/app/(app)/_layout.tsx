import { useAppearanceTheme } from "@bthwani/design-system/native";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, Tabs, usePathname, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";
import { useOwnFieldAdmission } from "../../src/features/field-operations/use-field-admission";
import { createFieldTabOptions } from "../../src/shell/field-shell";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };
export default function FieldAppLayout() { const router = useRouter(); const pathname = usePathname(); const onUnauthenticated = useCallback(() => router.replace(pathname === "/" ? "/" : `/?returnTo=${encodeURIComponent(pathname)}` as Href), [pathname, router]); return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><FieldTabs /></AuthenticatedMobileBoundary>; }

function FieldTabs() {
  const theme = useAppearanceTheme();
  const tabOptions = useMemo(() => createFieldTabOptions(theme), [theme]);
  const { state } = useOwnFieldAdmission();
  const eligible = state.kind === "ready" && state.admission.state === "eligible";
  return <Tabs screenOptions={tabOptions}><Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "جاهزية الميدان" }} /><Tabs.Screen name="cases" options={eligible ? { title: "الشركاء", tabBarAccessibilityLabel: "الشركاء" } : { href: null }} /><Tabs.Screen name="wallet" options={eligible ? { title: "المحفظة", tabBarAccessibilityLabel: "محفظة الميدان" } : { href: null }} /><Tabs.Screen name="account" options={{ title: "الحساب", tabBarAccessibilityLabel: "حساب الميدان" }} /><Tabs.Screen name="new-case" options={{ href: null }} /><Tabs.Screen name="catalog/[caseId]" options={{ href: null }} /></Tabs>;
}
