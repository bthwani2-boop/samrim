import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, Text, View } from "react-native";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { AlertTone } from "./alert-tone";

export type { AlertTone } from "./alert-tone";
const names: Record<AlertTone, string> = { classic: "الأساسي", soft: "هادئ", urgent: "واضح" };
const tones: readonly AlertTone[] = ["classic", "soft", "urgent"];
export function BthwaniOrderAlertPreferences({
  actorID, readTone, saveTone, isCurrentActor,
}: Readonly<{
  actorID: string;
  readTone: (actorID: string) => Promise<AlertTone>;
  saveTone: (actorID: string, tone: AlertTone, isCurrentActor: (actorID: string) => boolean) => Promise<boolean>;
  isCurrentActor: (actorID: string) => boolean;
}>) {
  const theme = useAppearanceTheme();
  const [toneState, setToneState] = useState<{ actorID: string; tone: AlertTone }>({ actorID: "", tone: "classic" });
  const tone = toneState.actorID === actorID ? toneState.tone : "classic";
  const actorRef = useRef(actorID);
  actorRef.current = actorID;
  const [permissionAction, setPermissionAction] = useState<"checking" | "none" | "ask" | "settings" | "unavailable">("checking");
  useEffect(() => {
    let active = true;
    setToneState({ actorID, tone: "classic" });
    if (actorID) {
      void readTone(actorID).then(value => {
        if (active && actorRef.current === actorID && isCurrentActor(actorID)) setToneState({ actorID, tone: value });
      }).catch(() => { /* Keep the default sound when storage is unavailable. */ });
    }
    return () => { active = false; };
  }, [actorID, readTone, isCurrentActor]);
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
    const selectedActor = actorID;
    if (!selectedActor || !isCurrentActor(selectedActor)) return;
    const saved = await saveTone(selectedActor, value, isCurrentActor);
    if (saved && actorRef.current === selectedActor && isCurrentActor(selectedActor)) setToneState({ actorID: selectedActor, tone: value });
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
