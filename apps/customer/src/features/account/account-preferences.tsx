import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

const preferences = [
  ["system", "النظام"], ["light", "فاتح"], ["dark", "داكن"],
] as const;

export default function AccountPreferences() {
  const { preference, setPreference, theme, ready } = useMobileAppearance();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const change = async (next: typeof preference) => {
    if (saving.current || !ready) return;
    saving.current = true;
    setPending(true);
    setFailed(false);
    try {
      await setPreference(next);
    } catch {
      setFailed(true);
    } finally {
      saving.current = false;
      setPending(false);
    }
  };
  const disabled = pending || !ready;
  return (
    <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor,
      borderRadius: 12, padding: 16, gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 18, fontWeight: "700" }}>مظهر التطبيق</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="مظهر التطبيق"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {preferences.map(([value, label]) => {
          const selected = value === preference;
          return (
            <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label}
              aria-checked={selected} accessibilityState={{ checked: selected, disabled }}
              disabled={disabled} onPress={() => void change(value)} style={{
                backgroundColor: selected ? theme.actionSoft : theme.surface,
                borderWidth: 1, borderColor: selected ? theme.interactiveText : theme.borderColor,
                borderRadius: 10, minHeight: 44, paddingHorizontal: 14, justifyContent: "center",
              }}>
              <Text style={{ color: selected ? theme.interactiveText : theme.color, fontWeight: "600" }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {failed ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>تعذّر حفظ المظهر. حاول مجددًا.</Text> : null}
    </View>
  );
}
