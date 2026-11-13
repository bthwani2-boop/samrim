import type { ThemeColors } from "@bthwani/design-system/theme";
import { isThemePreference, resolveTheme, resolveThemeName, type ThemeName, type ThemePreference } from "@bthwani/design-system/theme";
import * as React from "react";
import { Appearance, Platform } from "react-native";
import { TamaguiProvider, Theme } from "tamagui";
import { tamaguiConfig } from "./index";

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
  let confirmedPreference: ThemePreference = "system";
  let intentRevision = 0;
  let restoreRevision = 0;
  let disposed = false;
  // Serialize storage writes: the last user choice must also win on disk.
  let writeQueue: Promise<void> = Promise.resolve();
  const notify = () => listeners.forEach(listener => { listener(); });
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
      const intentAtStart = intentRevision;
      const restoreAtStart = ++restoreRevision;
      let preference: ThemePreference = "system";
      try {
        const stored = await storage.getItem(key);
        if (isThemePreference(stored)) preference = stored;
      } catch {
        // Storage failure must not prevent initial app rendering.
      }
      // A delayed restore cannot undo a newer choice or revive a disposed app.
      if (disposed || intentAtStart !== intentRevision || restoreAtStart !== restoreRevision) return;
      confirmedPreference = preference;
      applyNative(preference);
      update(preference, true);
    },
    async setPreference(preference: ThemePreference) {
      if (disposed) throw new Error("Appearance controller disposed");
      if (!isThemePreference(preference)) throw new Error("Invalid theme preference");
      // An explicit tap during initial restore still supersedes the stored value.
      if (snapshot.preference === preference && snapshot.ready) return;
      const revision = ++intentRevision;
      applyNative(preference);
      update(preference, true);
      // Do not allow an earlier slow write to overwrite a later preference.
      const write = writeQueue.then(() => storage.setItem(key, preference));
      writeQueue = write.then(() => undefined, () => undefined);
      try {
        await write;
        confirmedPreference = preference;
      } catch (error) {
        // Failure of an older request must never roll back a newer choice.
        if (!disposed && revision === intentRevision) {
          applyNative(confirmedPreference);
          update(confirmedPreference, true);
        }
        throw error;
      }
    },
    dispose() {
      disposed = true;
      intentRevision++;
      restoreRevision++;
      appearanceSubscription?.remove();
      listeners.clear();
    },
  };
}

export function useStage4AppearanceController(
  key: string,
  nativeGetItem: AppearanceStorage["getItem"],
  nativeSetItem: AppearanceStorage["setItem"],
): MobileAppearanceController {
  const storage = React.useMemo<AppearanceStorage>(() =>
    Platform.OS === "web"
      ? {
          getItem: async (storageKey) => window.localStorage.getItem(storageKey),
          setItem: async (storageKey, value) => { window.localStorage.setItem(storageKey, value); },
        }
      : { getItem: nativeGetItem, setItem: nativeSetItem }, [nativeGetItem, nativeSetItem]);
  const controller = React.useMemo(() => createMobileAppearanceController({ storage, key }), [key, storage]);
  React.useEffect(() => () => controller.dispose(), [controller]);
  return controller;
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
export function MobileThemeProvider({ children }: { children: React.ReactNode }) {
  const { themeName } = useMobileAppearance();
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={themeName}>
      <Theme name={themeName}>{children}</Theme>
    </TamaguiProvider>
  );
}