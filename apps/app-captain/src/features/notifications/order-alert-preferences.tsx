import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
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
  useEffect(() => { let mounted=true; void currentAlertTone().then(value => { if (mounted) setTone(value); }); return () => { mounted=false; }; }, []);
  if (Platform.OS === "web") return null;
  const choose = async (value: AlertTone) => {
    try {
      const key = await storageKey();
      if (!key) return;
      await SecureStore.setItemAsync(key, value);
      setTone(value);
    } catch { /* Retain the prior saved setting if device storage is unavailable. */ }
  };
  return <View style={{ gap: 8, marginVertical: 12 }}>
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
