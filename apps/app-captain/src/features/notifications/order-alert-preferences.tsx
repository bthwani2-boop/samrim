import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { AppState, Linking, Platform, Pressable, Text, View } from "react-native";
import { currentIdentityState } from "../../bootstrap/identity";

export type AlertTone = "classic" | "soft" | "urgent";
const names: Record<AlertTone, string> = { classic: "الأساسي", soft: "هادئ", urgent: "واضح" };
const tones: readonly AlertTone[] = ["classic", "soft", "urgent"];
const storageKey = async (): Promise<string> => {
  const session = currentIdentityState();
  if (session.kind !== "authenticated") return "";
  const actor = session.identity.subject.trim();
  if (!actor) return "";
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, actor);
  return `order-alert-tone-${digest}`;
};
export async function currentAlertTone(): Promise<AlertTone> {
  if (Platform.OS === "web") return "classic";
  try {
    const key = await storageKey();
    if (!key) return "classic";
    const tone = await SecureStore.getItemAsync(key);
    return tones.includes(tone as AlertTone) ? tone as AlertTone : "classic";
  } catch { return "classic"; }
}
export function OrderAlertPreferences() {
  const theme = useAppearanceTheme();
  const [tone, setTone] = useState<AlertTone>("classic");
  const [permissionAction, setPermissionAction] = useState<"checking" | "none" | "ask" | "settings" | "unavailable">("checking");
  useEffect(() => { let mounted=true; void currentAlertTone().then(value => { if (mounted) setTone(value); }); return () => { mounted=false; }; }, []);
  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    const read = async () => {
      try {
        const Notifications = await import("expo-notifications");
        const status = await Notifications.getPermissionsAsync();
        if (active) setPermissionAction(status.granted ? "none" : status.canAskAgain ? "ask" : "settings");
      } catch {
        if (active) setPermissionAction("unavailable");
      }
    };
    void read();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void read();
    });
    return () => { active = false; listener.remove(); };
  }, []);
  if (Platform.OS === "web") return null;
  const choose = async (value: AlertTone) => {
    try {
      const key = await storageKey();
      if (!key) return;
      await SecureStore.setItemAsync(key, value);
      setTone(value);
    } catch { /* Retain the prior saved setting if device storage is unavailable. */ }
  };
  const enableNotifications = async () => {
    if (permissionAction === "settings") {
      try { await Linking.openSettings(); } catch { /* Keep the app usable. */ }
      return;
    }
    if (permissionAction !== "ask") return;
    try {
      const Notifications = await import("expo-notifications");
      const status = await Notifications.requestPermissionsAsync();
      setPermissionAction(status.granted ? "none" : status.canAskAgain ? "ask" : "settings");
    } catch {
      setPermissionAction("unavailable");
    }
  };
  return <View style={{ gap: 8, marginVertical: 12 }}>
    {permissionAction === "ask" || permissionAction === "settings"
      ? <BthwaniButton label={permissionAction === "ask" ? "تفعيل إشعارات الطلبات" : "فتح إعدادات إذن الإشعارات"} onPress={() => void enableNotifications()} variant="secondary" />
      : null}
    {permissionAction === "unavailable"
      ? <Text accessibilityRole="alert" style={{ color: theme.colorMuted, fontSize: 12 }}>إشعارات النظام غير متاحة في هذا البناء.</Text>
      : null}
    <Text style={{ fontWeight: "700", fontSize: 15, color: theme.color }}>صوت تنبيه الطلبات</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {tones.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: tone===value }} onPress={() => void choose(value)}
        style={{ borderWidth: 1, borderColor: tone===value ? theme.interactiveText : theme.borderColor, backgroundColor: tone===value ? theme.actionSoft : theme.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 }}>
        <Text style={{ color: theme.color }}>{names[value]}</Text>
      </Pressable>)}
    </View>
    <Text style={{ fontSize: 12, color: theme.colorMuted }}>مستوى الصوت والاهتزاز من إعدادات الهاتف.</Text>
  </View>;
}
