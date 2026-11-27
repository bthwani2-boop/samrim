import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Notifications from "expo-notifications";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, Text, View } from "react-native";

type Reading =
  | { kind: "checking" | "opening" | "unavailable" | "settings-failed" }
  | { kind: "ready"; permission: "granted" | "limited" | "denied" };
type Scope = { active: boolean; revision: number };

/** Device permission only; no token, notification delivery or inbox authority. */
export default function CaptainDeviceNotificationSettings() {
  const { theme } = useMobileAppearance();
  const supported = Platform.OS === "android" || Platform.OS === "ios";
  const [reading, setReading] = useState<Reading>({ kind: "checking" });
  const latest = useRef(reading);
  const scope = useRef<Scope | null>(null);
  const command = useRef<object | null>(null);

  const publish = useCallback((next: Reading) => {
    latest.current = next;
    setReading(next);
  }, []);
  const read = useCallback(async (s: Scope) => {
    if (scope.current !== s || !s.active || command.current) return;
    const revision = ++s.revision;
    publish({ kind: "checking" });
    const current = () => scope.current === s && s.active && s.revision === revision;
    try {
      const permission = await Notifications.getPermissionsAsync();
      const limited = Platform.OS === "ios" &&
        (permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
          permission.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL);
      if (current()) publish({ kind: "ready",
        permission: limited ? "limited" : permission.granted ? "granted" : "denied" });
    } catch {
      if (current()) publish({ kind: "unavailable" });
    }
  }, [publish]);

  useFocusEffect(useCallback(() => {
    if (!supported) return;
    const s: Scope = { active: AppState.currentState === "active", revision: 0 };
    scope.current = s;
    publish({ kind: command.current ? "opening" : "checking" });
    if (s.active) void read(s);
    const subscription = AppState.addEventListener("change", state => {
      if (scope.current !== s) return;
      const active = state === "active";
      if (s.active === active) return;
      s.active = active;
      s.revision++;
      publish({ kind: command.current ? "opening" : "checking" });
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
  }, [publish, read, supported]));

  const renderedScope = scope.current;
  function actionableScope() {
    return renderedScope && scope.current === renderedScope && renderedScope.active &&
      !command.current && latest.current === reading && reading.kind !== "checking" &&
      reading.kind !== "opening" ? renderedScope : null;
  }
  function refresh() {
    const s = actionableScope();
    if (s) void read(s);
  }
  async function openSettings() {
    const s = actionableScope();
    if (!s) return;
    const revision = ++s.revision;
    const operation = {};
    command.current = operation;
    publish({ kind: "opening" });
    let failed = false;
    try {
      await Linking.openSettings();
    } catch {
      failed = true;
    } finally {
      command.current = null;
    }
    // A successful launch is not permission truth. Read only the currently
    // active scope; failures of obsolete scopes must not contaminate it.
    const active = scope.current;
    if (!active?.active) return;
    if (failed && active === s && active.revision === revision) {
      publish({ kind: "settings-failed" });
    } else {
      void read(active);
    }
  }

  const actionStyle = { borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10,
    minHeight: 48, justifyContent: "center" as const, paddingHorizontal: 14,
    alignSelf: "flex-start" as const };
  const canAct = supported && reading.kind !== "checking" && reading.kind !== "opening";
  return (
    <View testID="captain-device-notifications" style={{ gap: 10, padding: 18, borderWidth: 1,
      borderColor: theme.borderColor, borderRadius: 14, backgroundColor: theme.surface }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700", fontSize: 18 }}>إشعارات الجهاز</Text>
      {!supported ? (
        <Text style={{ color: theme.colorSecondary }}>يمكنك إدارة إذن الإشعارات من تطبيق الهاتف.</Text>
      ) : reading.kind === "checking" || reading.kind === "opening" ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
          {reading.kind === "opening" ? "جارٍ فتح الإعدادات…" : "جارٍ التحقق من إذن الإشعارات…"}
        </Text>
      ) : reading.kind === "settings-failed" ? (
        <Text testID="captain-notifications-settings-error" accessibilityRole="alert"
          style={{ color: theme.warningText }}>تعذّر فتح إعدادات التطبيق. حاول مجددًا.</Text>
      ) : reading.kind === "unavailable" ? (
        <Text testID="captain-notifications-read-error" accessibilityRole="alert"
          style={{ color: theme.warningText }}>تعذّر التحقق من الإذن. أعد المحاولة.</Text>
      ) : reading.kind === "ready" ? (
        <Text testID="captain-notifications-permission" style={{ color: reading.permission === "granted" ? theme.successText : theme.warningText }}>
          {reading.permission === "granted" ? "إذن الإشعارات ممنوح"
            : reading.permission === "limited" ? "إذن الإشعارات محدود" : "إذن الإشعارات غير ممنوح"}
        </Text>
      ) : null}
      {canAct ? (
        <>
          <Pressable accessibilityRole="button" testID="captain-notifications-settings"
            onPress={() => void openSettings()} style={actionStyle}>
            <Text style={{ color: theme.interactiveText }}>فتح إعدادات التطبيق</Text>
          </Pressable>
          <Pressable accessibilityRole="button" testID="captain-notifications-refresh" onPress={refresh} style={actionStyle}>
            <Text style={{ color: theme.interactiveText }}>إعادة التحقق</Text>
          </Pressable>
        </>
      ) : null}
      <Text style={{ color: theme.colorSecondary, lineHeight: 24 }}>
        هذه حالة إذن الجهاز فقط، وليست تأكيدًا على تفعيل إشعارات الطلبات أو وصولها.
      </Text>
    </View>
  );
}
