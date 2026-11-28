import { useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useMobileAppearance } from "./appearance";
import { createRadioGroup, type RadioKeyboardSelection } from "./radio-group";

const choices = [
  ["system", "حسب النظام"],
  ["light", "فاتح"],
  ["dark", "داكن"],
] as const;

// One preference writer; Web adds the APG radio keyboard interaction to native semantics.
export default function AppearancePreferences() {
  const { preference, setPreference, theme, ready } = useMobileAppearance();
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const disabled = !ready || pending;
  const web = Platform.OS === "web";

  async function change(next: typeof preference, keyboard?: RadioKeyboardSelection) {
    if (!ready || saving.current || next === preference) return;
    saving.current = true;
    setPending(true);
    setFailed(false);
    try {
      await setPreference(next);
    } catch {
      setFailed(true);
      const document = keyboard?.target.ownerDocument;
      if (document && "activeElement" in document && document.activeElement === keyboard?.target) {
        keyboard.previous?.focus();
      }
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  const radio = createRadioGroup({ values: choices.map(([value]) => value), selected: preference, disabled, web,
    canSelect: () => !saving.current, onSelect: change });

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
            <Pressable key={value} {...radio(value)} accessibilityLabel={label} style={{
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
