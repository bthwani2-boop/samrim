import * as React from "react";
import { Appearance } from "react-native";
import { isThemePreference, resolveTheme, resolveThemeName, type ThemeName, type ThemePreference } from "../theme/index";
import type { ThemeColors } from "../tokens/index";

// Stage-4 appearance foundation: React Native system preference and the
// canonical BThwani semantic token source. No native Expo UI picker and no
// second design runtime. Identity-scoped persistence joins later with Identity.
export type AppearanceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
export type MobileAppearanceSnapshot = {
  preference: ThemePreference;
  themeName: ThemeName;
  theme: ThemeColors;
  ready: boolean;
};
export type MobileAppearanceController = ReturnType<typeof createMobileAppearanceController>;

export function createMobileAppearanceController({ storage, key }: { storage: AppearanceStorage; key: string }) {
  let systemScheme = Appearance.getColorScheme();
  const listeners = new Set<() => void>();
  const snapshotFor = (preference: ThemePreference, ready: boolean): MobileAppearanceSnapshot => {
    const themeName = resolveThemeName(preference, systemScheme);
    return { preference, themeName, theme: resolveTheme(themeName), ready };
  };
  let snapshot = snapshotFor("system", false);
  const notify = () => listeners.forEach(listener => listener());
  const update = (preference: ThemePreference, ready = snapshot.ready) => {
    snapshot = snapshotFor(preference, ready);
    notify();
  };
  const appearanceSubscription = Appearance.addChangeListener(({ colorScheme }) => {
    systemScheme = colorScheme;
    if (snapshot.preference === "system") update("system");
  });
  const applyNative = (preference: ThemePreference) => {
    Appearance.setColorScheme?.(preference === "system" ? "unspecified" : preference);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async restore() {
      let preference: ThemePreference = "system";
      try {
        const stored = await storage.getItem(key);
        if (isThemePreference(stored)) preference = stored;
      } catch {
        // An unavailable storage service must not block the preview app.
      }
      applyNative(preference);
      update(preference, true);
    },
    async setPreference(preference: ThemePreference) {
      if (!isThemePreference(preference)) throw new Error("Invalid theme preference");
      const prior = snapshot.preference;
      if (prior === preference) return;
      applyNative(preference);
      update(preference);
      try {
        await storage.setItem(key, preference);
      } catch (error) {
        applyNative(prior);
        update(prior);
        throw error;
      }
    },
    dispose() {
      appearanceSubscription.remove();
      listeners.clear();
    },
  };
}

const AppearanceContext = React.createContext<MobileAppearanceController | null>(null);
export function AppearanceProvider({ controller, children }: { controller: MobileAppearanceController; children: React.ReactNode }) {
  const [ready, setReady] = React.useState(controller.getSnapshot().ready);
  React.useEffect(() => {
    let mounted = true;
    void controller.restore().finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, [controller]);
  if (!ready) return null;
  return <AppearanceContext.Provider value={controller}>{children}</AppearanceContext.Provider>;
}
export function useMobileAppearance(): MobileAppearanceSnapshot & { setPreference(preference: ThemePreference): Promise<void> } {
  const controller = React.useContext(AppearanceContext);
  if (!controller) throw new Error("AppearanceProvider required");
  return {
    ...React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot),
    setPreference: controller.setPreference,
  };
}
