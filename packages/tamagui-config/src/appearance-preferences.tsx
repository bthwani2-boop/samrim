import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMobileAppearance } from "./appearance";

const choices = [
  ["system", "حسب النظام"],
  ["light", "فاتح"],
  ["dark", "داكن"],
] as const;

// Native Pressable preserves explicit Web and Android radio semantics.
export default function AppearancePreferences() {
  const { preference, setPreference, theme, ready } = useMobileAppearance();
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: typeof preference) {
    if (!ready || saving.current) return;
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
  }

  const disabled = !ready || pending;
  return (
    <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor,
      borderRadius: 12, padding: 16, gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 18, fontWeight: "700" }}>مظهر التطبيق</Text>
      <Text style={{ color: theme.colorSecondary }}>تفضيل المظهر على هذا الجهاز</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="مظهر التطبيق"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {choices.map(([value, label]) => {
          const selected = value === preference;
          return (
            <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label}
              aria-checked={selected} accessibilityState={{ checked: selected, disabled }}
              disabled={disabled} onPress={() => change(value)} style={{
                backgroundColor: selected ? theme.actionSoft : theme.surface,
                borderWidth: 1, borderColor: selected ? theme.interactiveText : theme.borderColor,
                borderRadius: 10, minHeight: 48, paddingHorizontal: 14, justifyContent: "center",
                opacity: disabled ? 0.55 : 1,
              }}>
              <Text style={{ color: selected ? theme.interactiveText : theme.color, fontWeight: "600" }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {pending ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>جارٍ حفظ المظهر…</Text> : null}
      {failed ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>تعذّر حفظ المظهر. حاول مجددًا.</Text> : null}
    </View>
  );
}
