import type { ComponentRef } from "react";
import type { Pressable } from "react-native";

type Value = string | boolean | undefined;
type RadioHost = ComponentRef<typeof Pressable>;
type RadioKeyEvent = { nativeEvent: { key: string }; preventDefault(): void };
export type RadioKeyboardSelection = Readonly<{ target: RadioHost; previous: RadioHost | undefined }>;

// Presentation only: a fresh group belongs to one rendered option set.
// Owner callbacks still decide whether a choice may change business state.
export function createRadioGroup<T extends Value>({ values, selected, disabled = false, web, onSelect, canSelect = () => true }: Readonly<{
  values: readonly T[];
  selected: NoInfer<T> | null;
  disabled?: boolean;
  web: boolean;
  onSelect: (value: NoInfer<T>, keyboard?: RadioKeyboardSelection) => void;
  canSelect?: () => boolean;
}>) {
  const hosts = new Map<T, RadioHost>();
  const selectedIndex = values.findIndex(value => value === selected);
  const tabStop = selectedIndex < 0 ? 0 : selectedIndex;
  const allowed = () => !disabled && canSelect();
  return (value: T) => {
    const index = values.indexOf(value);
    const checked = index >= 0 && index === selectedIndex;
    const webProps = web ? {
      tabIndex: (index >= 0 && !disabled && index === tabStop ? 0 : -1) as 0 | -1,
      ref: (host: RadioHost | null) => {
        if (host) hosts.set(value, host);
        else hosts.delete(value);
      },
      onKeyDown(event: RadioKeyEvent) {
        const { key } = event.nativeEvent;
        const step = key === "ArrowRight" || key === "ArrowDown" ? 1 :
          key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        if (!allowed() || index < 0 || !hosts.has(value) || values.length < 2) return;
        const nextIndex = (index + step + values.length) % values.length;
        const next = values[nextIndex] as T;
        const target = hosts.get(next);
        if (!target) return;
        const previous = selectedIndex < 0 ? undefined : hosts.get(values[selectedIndex] as T);
        target.focus();
        onSelect(next, { target, previous });
      },
    } : {};
    return { accessibilityRole: "radio" as const, "aria-checked": checked,
      accessibilityState: { checked, disabled }, disabled,
      onPress: () => { if (index >= 0 && allowed()) return onSelect(value); }, ...webProps };
  };
}
