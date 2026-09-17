import { Icon } from "@expo/ui";
import * as React from "react";
import {
  Appearance,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from "react-native";

import {
  isThemePreference,
  resolveTheme,
  resolveThemeName,
  type ThemeName,
  type ThemePreference,
} from "../theme/index";
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
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 16, borderWidth: 1, gap: 8, padding: 14 },
    title: { color: theme.color, fontSize: 15, fontWeight: "800" },
    helper: { color: theme.colorMuted, fontSize: 13, lineHeight: 19 },
    options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    option: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 44, minWidth: 84, paddingHorizontal: 12 },
    selectedOption: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    disabledOption: { opacity: 0.55 },
    optionText: { color: theme.color, fontSize: 13, fontWeight: "700" },
    selectedOptionText: { color: theme.interactiveText },
    error: { color: theme.danger, fontSize: 13 },
  });
}

export type MobileIconName =
  | "home"
  | "orders"
  | "account"
  | "store"
  | "offers"
  | "deliveries"
  | "cases"
  | "cart"
  | "back"
  | "forward"
  | "add"
  | "edit"
  | "location"
  | "appearance"
  | "refresh"
  | "warning"
  | "success";

const iconNames: Record<MobileIconName, ReturnType<typeof Icon.select>> = {
  home: Icon.select({ ios: "house.fill", android: require("@expo/material-symbols/home.xml") }),
  orders: Icon.select({ ios: "list.bullet.rectangle", android: require("@expo/material-symbols/receipt_long.xml") }),
  account: Icon.select({ ios: "person.fill", android: require("@expo/material-symbols/person.xml") }),
  store: Icon.select({ ios: "storefront", android: require("@expo/material-symbols/storefront.xml") }),
  offers: Icon.select({ ios: "tag.fill", android: require("@expo/material-symbols/sell.xml") }),
  deliveries: Icon.select({ ios: "truck.box.fill", android: require("@expo/material-symbols/local_shipping.xml") }),
  cases: Icon.select({ ios: "folder.fill", android: require("@expo/material-symbols/folder.xml") }),
  cart: Icon.select({ ios: "cart.fill", android: require("@expo/material-symbols/shopping_cart.xml") }),
  back: Icon.select({ ios: "chevron.backward", android: require("@expo/material-symbols/arrow_back.xml") }),
  forward: Icon.select({ ios: "chevron.forward", android: require("@expo/material-symbols/arrow_forward.xml") }),
  add: Icon.select({ ios: "plus", android: require("@expo/material-symbols/add.xml") }),
  edit: Icon.select({ ios: "pencil", android: require("@expo/material-symbols/edit.xml") }),
  location: Icon.select({ ios: "mappin.and.ellipse", android: require("@expo/material-symbols/location_on.xml") }),
  appearance: Icon.select({ ios: "circle.lefthalf.filled", android: require("@expo/material-symbols/brightness_6.xml") }),
  refresh: Icon.select({ ios: "arrow.clockwise", android: require("@expo/material-symbols/refresh.xml") }),
  warning: Icon.select({ ios: "exclamationmark.triangle", android: require("@expo/material-symbols/warning.xml") }),
  success: Icon.select({ ios: "checkmark.circle", android: require("@expo/material-symbols/check_circle.xml") }),
};

export function BthwaniIcon({
  name,
  color,
  size = 22,
  accessibilityLabel,
}: {
  name: MobileIconName;
  color?: ColorValue;
  size?: number;
  accessibilityLabel?: string;
}) {
  const props: React.ComponentProps<typeof Icon> = { name: iconNames[name], size };
  if (color !== undefined) props.color = color;
  if (accessibilityLabel !== undefined) props.accessibilityLabel = accessibilityLabel;
  return <Icon {...props} />;
}
