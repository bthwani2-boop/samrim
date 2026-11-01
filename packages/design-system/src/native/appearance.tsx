import { Host, Picker } from "@expo/ui";
import * as React from "react";
import { Appearance, Text, View } from "react-native";
import { isThemePreference, parseStudioPalette, resolveStudioTheme, resolveThemeName, type StudioPalette, type ThemeName, type ThemePreference } from "../theme/index";
import type { ThemeColors } from "../tokens/index";

type AppearanceStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type MobileAppearanceSnapshot = {
  preference: ThemePreference;
  themeName: ThemeName;
  theme: ThemeColors;
  ready: boolean;
};

export type MobileAppearanceController = ReturnType<typeof createMobileAppearanceController>;

export function createMobileAppearanceController({
  storage,
  key,
}: {
  storage: AppearanceStorage;
  key: string;
}) {
  let systemColorScheme = Appearance.getColorScheme();
  let publishedPalette: StudioPalette | null = null;
  let snapshot: MobileAppearanceSnapshot = createSnapshot("system", false);
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => {
      listener();
    });
  };
  const apply = (preference: ThemePreference) => {
    if (typeof Appearance.setColorScheme === "function") Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
  };
  const setSnapshot = (preference: ThemePreference, ready = snapshot.ready) => {
    snapshot = createSnapshot(preference, ready);
    notify();
  };
  const systemSubscription = Appearance.addChangeListener(({ colorScheme }) => {
    systemColorScheme = colorScheme;
    if (snapshot.preference === "system") setSnapshot("system");
  });

  async function restore() {
    let preference: ThemePreference = "system";
    try {
      const stored = await storage.getItem(key);
      if (isThemePreference(stored)) preference = stored;
    } catch {
      preference = "system";
    }
    apply(preference);
    setSnapshot(preference, true);
  }

  async function setPreference(preference: ThemePreference) {
    const previous = snapshot.preference;
    if (previous === preference) return;
    apply(preference);
    setSnapshot(preference);
    try {
      await storage.setItem(key, preference);
    } catch (cause) {
      apply(previous);
      setSnapshot(previous);
      throw cause;
    }
  }

  return {
    getSnapshot: () => snapshot,
    setPublishedPalette(value: unknown): boolean {
      const parsed = value === null ? null : parseStudioPalette(value);
      if (value !== null && !parsed) return false;
      if (JSON.stringify(parsed) === JSON.stringify(publishedPalette)) return true;
      publishedPalette = parsed;
      setSnapshot(snapshot.preference);
      return true;
    },
    restore,
    setPreference,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      systemSubscription.remove();
      listeners.clear();
    },
  };

  function createSnapshot(preference: ThemePreference, ready: boolean): MobileAppearanceSnapshot {
    const themeName = resolveThemeName(preference, systemColorScheme);
    return { preference, themeName, theme: resolveStudioTheme(themeName, publishedPalette), ready };
  }
}

const AppearanceContext = React.createContext<MobileAppearanceController | null>(null);

export function AppearanceProvider({
  controller,
  children,
}: {
  controller: MobileAppearanceController;
  children: React.ReactNode;
}) {
  const [restored, setRestored] = React.useState(controller.getSnapshot().ready);

  React.useEffect(() => {
    let active = true;
    void controller.restore().finally(() => {
      if (active) setRestored(true);
    });
    return () => {
      active = false;
    };
  }, [controller]);

  if (!restored) return null;
  return <AppearanceContext.Provider value={controller}>{children}</AppearanceContext.Provider>;
}

export function useMobileAppearance(): MobileAppearanceSnapshot & {
  setPreference: (preference: ThemePreference) => Promise<void>;
} {
  const controller = React.useContext(AppearanceContext);
  if (!controller) throw new Error("useMobileAppearance must be used inside AppearanceProvider");
  const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { ...snapshot, setPreference: controller.setPreference };
}

export function useAppearanceTheme(): ThemeColors {
  return useMobileAppearance().theme;
}

export const appearanceOptions: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "حسب النظام" },
  { value: "light", label: "فاتح" },
  { value: "dark", label: "داكن" },
];

export function AppearancePicker({ compact = false, title = "المظهر", helper = "اختر مظهر التطبيق" }: { compact?: boolean; title?: string; helper?: string }) {
  const { preference, setPreference, theme, themeName } = useMobileAppearance();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function select(next: ThemePreference) {
    if (busy || next === preference) return;
    setBusy(true);
    setError("");
    try {
      await setPreference(next);
    } catch {
      setError("تعذر حفظ المظهر. أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      accessibilityLabel={title}
      style={{
        alignItems: compact ? "center" : "stretch",
        backgroundColor: theme.surface,
        borderColor: theme.borderColor,
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: compact ? "row" : "column",
        flexWrap: "wrap",
        gap: 8,
        padding: compact ? 8 : 12,
      }}
    >
      <Text style={{ color: theme.color, flexShrink: 1, fontWeight: "600" }}>{title}</Text>
      {helper ? <Text style={{ color: theme.colorMuted, flexShrink: 1 }}>{helper}</Text> : null}
      <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
        <Picker
          enabled={!busy}
          selectedValue={preference}
          onValueChange={(next) => { if (isThemePreference(next)) void select(next); }}
          testID="appearance-theme-picker"
        >
          {appearanceOptions.map((option) => (
            <Picker.Item key={option.value} label={option.label} value={option.value} />
          ))}
        </Picker>
      </Host>
      {error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}
    </View>
  );
}