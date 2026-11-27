import { type ComponentRef, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useMobileAppearance } from "./appearance";

const choices = [
  ["system", "حسب النظام"],
  ["light", "فاتح"],
  ["dark", "داكن"],
] as const;

type RadioHost = ComponentRef<typeof Pressable>;
type RadioKeyEvent = { nativeEvent: { key: string }; preventDefault(): void };

// One preference writer; Web adds the APG radio keyboard interaction to native semantics.
export default function AppearancePreferences() {
  const { preference, setPreference, theme, ready } = useMobileAppearance();
  const saving = useRef(false);
  const radios = useRef<Array<RadioHost | null>>([]);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const disabled = !ready || pending;
  const web = Platform.OS === "web";

  async function change(next: typeof preference, keyboardTarget?: RadioHost) {
    if (!ready || saving.current || next === preference) return;
    const previous = radios.current[choices.findIndex(([value]) => value === preference)];
    saving.current = true;
    setPending(true);
    setFailed(false);
    try {
      await setPreference(next);
    } catch {
      setFailed(true);
      const document = keyboardTarget?.ownerDocument;
      if (document && "activeElement" in document && document.activeElement === keyboardTarget) {
        previous?.focus();
      }
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  function move(event: RadioKeyEvent, index: number) {
    const { key } = event.nativeEvent;
    const step = key === "ArrowRight" || key === "ArrowDown" ? 1 :
      key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    if (disabled || saving.current) return;
    const nextIndex = (index + step + choices.length) % choices.length;
    const next = choices[nextIndex];
    const target = radios.current[nextIndex];
    if (!next || !target) return;
    target.focus();
    void change(next[0], target);
  }

  return (
    <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor,
      borderRadius: 12, padding: 16, gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 18, fontWeight: "700" }}>مظهر التطبيق</Text>
      <Text style={{ color: theme.colorSecondary }}>تفضيل المظهر على هذا الجهاز</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="مظهر التطبيق"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {choices.map(([value, label], index) => {
          const selected = value === preference;
          const tabIndex: 0 | -1 = selected && !disabled ? 0 : -1;
          const webProps = web ? {
            tabIndex,
            onKeyDown: (event: RadioKeyEvent) => move(event, index),
            ref: (host: ComponentRef<typeof Pressable> | null) => {
              radios.current[index] = host;
            },
          } : {};
          return (
            <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label}
              aria-checked={selected} accessibilityState={{ checked: selected, disabled }}
              {...webProps}
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
