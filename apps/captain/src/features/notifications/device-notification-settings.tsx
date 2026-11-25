import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Notifications from "expo-notifications";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, Text, View } from "react-native";

type Reading =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "ready"; permission: "granted" | "limited" | "denied" };
type Scope = { active: boolean; revision: number };

/** OS permission only. No push token, channel policy, delivery or inbox authority. */
export default function CaptainDeviceNotificationSettings() {
  const { theme } = useMobileAppearance();
  const supported = Platform.OS === "android" || Platform.OS === "ios";
  const [reading, setReading] = useState<Reading>({ kind: "checking" });
  const [opening, setOpening] = useState(false);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const latest = useRef(reading);
  const scope = useRef<Scope | null>(null);
  const openingRef = useRef(false);

  const publish = useCallback((next: Reading) => {
    latest.current = next;
    setReading(next);
  }, []);
  const current = useCallback((s: Scope, revision: number) =>
    scope.current === s && s.active && s.revision === revision, []);
  const read = useCallback(async (s: Scope) => {
    if (scope.current !== s || !s.active) return;
    const revision = ++s.revision;
    setSettingsFailed(false);
    publish({ kind: "checking" });
    try {
      const permission = await Notifications.getPermissionsAsync();
      const limited = Platform.OS === "ios" &&
        (permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
          permission.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL);
      if (current(s, revision)) publish({ kind: "ready",
        permission: limited ? "limited" : permission.granted ? "granted" : "denied" });
    } catch {
      if (current(s, revision)) publish({ kind: "unavailable" });
    }
  }, [current, publish]);

  useFocusEffect(useCallback(() => {
    if (!supported) return;
    const s: Scope = { active: AppState.currentState === "active", revision: 0 };
    scope.current = s;
    publish({ kind: "checking" });
    setSettingsFailed(false);
    if (s.active) void read(s);
    const subscription = AppState.addEventListener("change", state => {
      if (scope.current !== s) return;
      s.active = state === "active";
      s.revision++;
      publish({ kind: "checking" });
      if (s.active) void read(s);
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
  function currentScope() {
    return renderedScope && scope.current === renderedScope && renderedScope.active &&
      latest.current === reading ? renderedScope : null;
  }
  function refresh() {
    const s = currentScope();
    if (s && !openingRef.current) void read(s);
  }
  async function openSettings() {
    const s = currentScope();
    if (!s || reading.kind === "checking" || openingRef.current) return;
    const revision = s.revision;
    openingRef.current = true;
    setOpening(true);
    setSettingsFailed(false);
    try {
      await Linking.openSettings();
    } catch {
      if (current(s, revision)) setSettingsFailed(true);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }

  const actionStyle = { borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10,
    minHeight: 48, justifyContent: "center" as const, paddingHorizontal: 14,
    alignSelf: "flex-start" as const, opacity: opening ? 0.55 : 1 };
  return (
    <View testID="captain-device-notifications" style={{ gap: 10, padding: 18, borderWidth: 1,
      borderColor: theme.borderColor, borderRadius: 14, backgroundColor: theme.surface }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700", fontSize: 18 }}>إشعارات الجهاز</Text>
      {!supported ? (
        <Text style={{ color: theme.colorSecondary }}>يمكنك إدارة إذن الإشعارات من تطبيق الهاتف.</Text>
      ) : reading.kind === "checking" ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>جارٍ التحقق من إذن الإشعارات…</Text>
      ) : reading.kind === "unavailable" ? (
        <Text testID="captain-notifications-read-error" accessibilityRole="alert"
          style={{ color: theme.warningText }}>تعذّر التحقق من الإذن. أعد المحاولة.</Text>
      ) : (
        <Text testID="captain-notifications-permission" style={{ color: reading.permission === "granted" ? theme.successText : theme.warningText }}>
          {reading.permission === "granted" ? "إذن الإشعارات ممنوح"
            : reading.permission === "limited" ? "إذن الإشعارات محدود" : "إذن الإشعارات غير ممنوح"}
        </Text>
      )}
      {supported && reading.kind !== "checking" ? (
        <>
          <Pressable accessibilityRole="button" testID="captain-notifications-settings" disabled={opening}
            accessibilityState={{ disabled: opening, busy: opening }} onPress={() => void openSettings()} style={actionStyle}>
            <Text style={{ color: theme.interactiveText }}>{opening ? "جارٍ فتح الإعدادات…" : "فتح إعدادات التطبيق"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" testID="captain-notifications-refresh" disabled={opening}
            accessibilityState={{ disabled: opening }} onPress={refresh} style={actionStyle}>
            <Text style={{ color: theme.interactiveText }}>إعادة التحقق</Text>
          </Pressable>
          {settingsFailed ? <Text testID="captain-notifications-settings-error" accessibilityRole="alert"
            style={{ color: theme.warningText }}>تعذّر فتح إعدادات التطبيق. حاول مجددًا.</Text> : null}
        </>
      ) : null}
      <Text style={{ color: theme.colorSecondary, lineHeight: 24 }}>
        هذه حالة إذن الجهاز فقط، وليست تأكيدًا على تفعيل إشعارات الطلبات أو وصولها.
      </Text>
    </View>
  );
}
