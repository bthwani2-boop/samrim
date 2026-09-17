import * as React from "react";
import { Appearance, Pressable, StyleSheet, Text, View } from "react-native";
import { isThemePreference, resolveTheme, resolveThemeName, type ThemeName, type ThemePreference } from "../theme/index";
import { borders, direction, opacity, radius, resolveTextAlign, sizing, spacing, type ThemeColors, typography } from "../tokens/index";

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
  let snapshot: MobileAppearanceSnapshot = createSnapshot("system", false);
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => {
      listener();
    });
  };
  const apply = (preference: ThemePreference) => {
    Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
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
    return { preference, themeName, theme: resolveTheme(themeName), ready };
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

export function AppearancePicker({ title = "المظهر", helper = "اختر مظهر التطبيق" }: { title?: string; helper?: string }) {
  const { preference, setPreference, theme } = useMobileAppearance();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const styles = React.useMemo(() => createAppearanceStyles(theme), [theme]);

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
    <View style={styles.container} accessibilityLabel={title}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.helper}>{helper}</Text>
      <View style={styles.options}>
        {appearanceOptions.map((option) => {
          const selected = preference === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ busy, disabled: busy, selected }}
              disabled={busy}
              onPress={() => void select(option.value)}
              style={[styles.option, selected && styles.selectedOption, busy && styles.disabledOption]}
            >
              <Text style={[styles.optionText, selected && styles.selectedOptionText]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createAppearanceStyles(theme: ThemeColors) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, direction: activeDirection, gap: spacing[2], padding: spacing[3] },
    title: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    helper: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    options: { direction: activeDirection, flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    option: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    selectedOption: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    disabledOption: { opacity: opacity.disabled },
    optionText: { ...typography.bodySm, color: theme.color, textAlign: "center" },
    selectedOptionText: { color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.danger, textAlign: startTextAlign },
  });
}
