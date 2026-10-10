import { useAppearanceTheme } from "@bthwani/design-system/native";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, Tabs, usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { currentIdentityState, recordFieldAppOpened, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";
import { fieldAdmissionActionability } from "../../src/features/field-operations/field-eligibility";
import { FieldAdmissionProvider, useOwnFieldAdmission } from "../../src/features/field-operations/use-field-admission";
import { createFieldTabOptions } from "../../src/shell/field-shell";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };
export default function FieldAppLayout() { const router = useRouter(); const pathname = usePathname(); const onUnauthenticated = useCallback(() => router.replace(pathname === "/" ? "/" : `/?returnTo=${encodeURIComponent(pathname)}` as Href), [pathname, router]); return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><FieldAdmissionProvider><FieldTabs /></FieldAdmissionProvider></AuthenticatedMobileBoundary>; }

function FieldTabs() {
  const theme = useAppearanceTheme();
  const { state, verification, refresh } = useOwnFieldAdmission();
  const eligible = state.kind === "ready" && fieldAdmissionActionability(state.admission) === "available";
  const tabOptions = useMemo(() => createFieldTabOptions(theme, eligible && verification === "verified"), [theme, eligible, verification]);
  useEffect(() => {
    let wasActive = AppState.currentState === "active";
    const recordOpen = () => { void recordFieldAppOpened().catch(() => undefined); };
    if (wasActive) recordOpen();
    const subscription = AppState.addEventListener("change", (nextState) => {
      const becameActive = nextState === "active" && !wasActive;
      wasActive = nextState === "active";
      if (becameActive) { recordOpen(); void refresh(); }
    });
    return () => subscription.remove();
  }, [refresh]);
  return <Tabs screenOptions={tabOptions}><Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "جاهزية الميدان" }} /><Tabs.Screen name="cases" options={eligible ? { title: "الشركاء", tabBarAccessibilityLabel: "الشركاء" } : { href: null }} /><Tabs.Screen name="invitations" options={eligible ? { title: "الدعوات", tabBarAccessibilityLabel: "دعوات الوصول للمتاجر" } : { href: null }} /><Tabs.Screen name="wallet" options={eligible ? { title: "المحفظة", tabBarAccessibilityLabel: "محفظة الميدان" } : { href: null }} /><Tabs.Screen name="account" options={{ href: null }} /><Tabs.Screen name="new-case" options={{ href: null }} /><Tabs.Screen name="catalog/[caseId]" options={{ href: null }} /></Tabs>;
}
