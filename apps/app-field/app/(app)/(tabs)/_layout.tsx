import { useAppearanceTheme } from "@bthwani/design-system/native";
import { Tabs } from "expo-router";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { recordFieldAppOpened } from "../../../src/bootstrap/identity";
import { fieldAdmissionActionability } from "../../../src/features/field-operations/field-eligibility";
import { useOwnFieldAdmission } from "../../../src/features/field-operations/use-field-admission";
import { createFieldTabOptions } from "../../../src/shell/field-shell";

export default function FieldTabsLayout() {
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

  return <Tabs screenOptions={tabOptions}>
    <Tabs.Screen name="home" options={{ title: "الرئيسية", tabBarAccessibilityLabel: "جاهزية الميدان" }} />
    <Tabs.Screen name="cases" options={eligible ? { title: "الشركاء", tabBarAccessibilityLabel: "الشركاء" } : { href: null }} />
    <Tabs.Screen name="wallet" options={eligible ? { title: "المحفظة", tabBarAccessibilityLabel: "محفظة الميدان" } : { href: null }} />
    <Tabs.Screen name="account" options={{ title: "حسابي", tabBarAccessibilityLabel: "الحساب" }} />
  </Tabs>;
}
