import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, Text, View } from "react-native";

type Reading =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "ready"; granted: boolean; canAskAgain: boolean; servicesEnabled: boolean };
type Scope = { active: boolean; revision: number };
type NativeCommand = "permission" | "settings";

/** Device readiness only: no position collection, background tracking or dispatch authority. */
export default function CaptainDeviceLocationReadiness() {
  const { theme } = useMobileAppearance();
  const [reading, setReading] = useState<Reading>({ kind: "checking" });
  const latest = useRef(reading);
  const scope = useRef<Scope | null>(null);
  const pending = useRef<NativeCommand | null>(null);

  const publish = useCallback((next: Reading) => {
    latest.current = next;
    setReading(next);
  }, []);

  const read = useCallback(async (s: Scope) => {
    if (scope.current !== s || !s.active || pending.current !== null) return;
    const revision = ++s.revision;
    publish({ kind: "checking" });
    const isCurrent = () => scope.current === s && s.active && s.revision === revision;
    try {
      const [permission, servicesEnabled] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.hasServicesEnabledAsync(),
      ]);
      if (isCurrent()) {
        publish({ kind: "ready", granted: permission.granted,
          canAskAgain: permission.canAskAgain, servicesEnabled });
      }
    } catch {
      if (isCurrent()) publish({ kind: "unavailable" });
    }
  }, [publish]);

  useFocusEffect(useCallback(() => {
    if (Platform.OS === "web") return;
    const s: Scope = { active: AppState.currentState === "active", revision: 0 };
    scope.current = s;
    publish({ kind: "checking" });
    if (s.active) void read(s);
    const subscription = AppState.addEventListener("change", state => {
      if (scope.current !== s) return;
      const active = state === "active";
      if (s.active === active) return;
      s.active = active;
      s.revision++;
      publish({ kind: "checking" });
      if (active) void read(s);
    });
    return () => {
      subscription.remove();
      if (scope.current === s) {
        scope.current = null;
        s.active = false;
        s.revision++;
      }
    };
  }, [publish, read]));

  const renderedScope = scope.current;
  function actionableScope() {
    return renderedScope && scope.current === renderedScope && renderedScope.active &&
      pending.current === null && latest.current === reading ? renderedScope : null;
  }

  function refresh() {
    const s = actionableScope();
    if (s) void read(s);
  }

  async function runNativeCommand() {
    const s = actionableScope();
    if (!s || reading.kind !== "ready" || reading.granted) return;
    const command: NativeCommand = reading.canAskAgain ? "permission" : "settings";
    pending.current = command;
    const revision = ++s.revision;
    publish({ kind: "checking" });
    let failed = false;
    try {
      if (command === "permission") await Location.requestForegroundPermissionsAsync();
      else await Linking.openSettings();
    } catch {
      failed = true;
    } finally {
      pending.current = null;
    }
    // Dialog results are never permission truth. Only the current active scope
    // may read the device again; an old failure cannot mark a newer view failed.
    const active = scope.current;
    if (!active?.active) return;
    if (failed && active === s && active.revision === revision) {
      publish({ kind: "unavailable" });
    } else {
      void read(active);
    }
  }

  const actionStyle = { borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10,
    minHeight: 48, justifyContent: "center" as const, paddingHorizontal: 14, alignSelf: "flex-start" as const };
  return (
    <View testID="captain-device-location" style={{ gap: 10, padding: 18, borderWidth: 1,
      borderColor: theme.borderColor, borderRadius: 14, backgroundColor: theme.surface }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700", fontSize: 18 }}>الموقع على الجهاز</Text>
      {Platform.OS === "web" ? (
        <Text style={{ color: theme.colorSecondary }}>تحقق من إعدادات الموقع في تطبيق الهاتف.</Text>
      ) : reading.kind === "checking" ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>جارٍ التحقق من إعدادات الموقع…</Text>
      ) : reading.kind === "unavailable" ? (
        <Text accessibilityRole="alert" style={{ color: theme.warningText }}>تعذّر التحقق من الموقع. أعد المحاولة.</Text>
      ) : (
        <>
          <Text testID="captain-location-permission" style={{ color: reading.granted ? theme.successText : theme.warningText }}>
            {reading.granted ? "إذن الموقع متاح" : "إذن الموقع غير ممنوح"}
          </Text>
          <Text testID="captain-location-services" style={{ color: reading.servicesEnabled ? theme.successText : theme.warningText }}>
            {reading.servicesEnabled ? "خدمات الموقع مفعّلة" : "خدمات الموقع متوقفة"}
          </Text>
          {!reading.granted ? (
            <Pressable accessibilityRole="button"
              testID={reading.canAskAgain ? "captain-location-request" : "captain-location-settings"}
              onPress={() => void runNativeCommand()} style={actionStyle}>
              <Text style={{ color: theme.interactiveText }}>
                {reading.canAskAgain ? "منح إذن الموقع" : "فتح إعدادات التطبيق لمنح إذن الموقع"}
              </Text>
            </Pressable>
          ) : null}
          {!reading.servicesEnabled ? <Text style={{ color: theme.colorSecondary }}>فعّل خدمات الموقع من إعدادات الجهاز.</Text> : null}
        </>
      )}
      {Platform.OS !== "web" && reading.kind !== "checking" ? (
        <Pressable accessibilityRole="button" testID="captain-location-refresh" onPress={refresh} style={actionStyle}>
          <Text style={{ color: theme.interactiveText }}>إعادة التحقق</Text>
        </Pressable>
      ) : null}
      <Text style={{ color: theme.colorSecondary, lineHeight: 24 }}>
        هذه حالة إعدادات الجهاز فقط؛ لا تعني تفعيل استقبال الطلبات أو إرسال موقعك.
      </Text>
    </View>
  );
}
