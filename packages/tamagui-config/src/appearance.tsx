import * as React from "react";
import { Appearance, Platform } from "react-native";
import { isThemePreference, resolveTheme, resolveThemeName, type ThemeName, type ThemePreference } from "@bthwani/design-system/theme";
import type { ThemeColors } from "@bthwani/design-system/theme";

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
  // React SSR creates request-local controllers; do not retain process-wide
  // Appearance subscriptions for a server render that never mounts an effect.
  const appearanceSubscription = Platform.OS === "web" && typeof window === "undefined"
    ? null
    : Appearance.addChangeListener(({ colorScheme }) => {
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
      appearanceSubscription?.remove();
      listeners.clear();
    },
  };
}

const AppearanceContext = React.createContext<MobileAppearanceController | null>(null);

// Stable, request-independent snapshot: SSR and the initial hydration render agree.
// The stored/system preference is restored after hydration without hiding page content.
const serverAppearance: MobileAppearanceSnapshot = {
  preference: "system",
  themeName: "light",
  theme: resolveTheme("light"),
  ready: false,
};
const getServerAppearance = () => serverAppearance;

export function AppearanceProvider({ controller, children }: { controller: MobileAppearanceController; children: React.ReactNode }) {
  React.useEffect(() => {
    void controller.restore();
  }, [controller]);
  return <AppearanceContext.Provider value={controller}>{children}</AppearanceContext.Provider>;
}
export function useMobileAppearance(): MobileAppearanceSnapshot & { setPreference(preference: ThemePreference): Promise<void> } {
  const controller = React.useContext(AppearanceContext);
  if (!controller) throw new Error("AppearanceProvider required");
  return {
    ...React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, getServerAppearance),
    setPreference: controller.setPreference,
  };
}